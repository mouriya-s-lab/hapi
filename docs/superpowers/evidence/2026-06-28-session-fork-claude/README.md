# Session fork — Claude end-to-end evidence (T19)

Date: 2026-06-30
Setup: independent dev environment (`HAPI_HOME=~/.hapi-dev-fork-e2e`, hub on `127.0.0.1:3106`, vite web on `:5173`, dev cli runner connected to dev hub). Production `~/.hapi` runner / `https://hapi.237575.xyz` untouched.

## Result: PASS

Forking a Claude session via the new `/api/sessions/:id/fork` endpoint produces a fully independent hapi session whose Claude session id, on-disk JSONL, and conversation thread are decoupled from the source.

## Bugs found and fixed during e2e (not seen in unit tests)

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | `GET /api/flavors/capabilities` returned `{"fork":[]}` → Fork menu item hidden | Hub-side `providerRegistry` is a per-process module-level Map; cli's `register.ts` runs in cli process only, leaving hub's registry empty. | Introduced `forkCapabilities.ts` as the static, process-agnostic capability list (consumed by hub-side capabilities endpoint + forkController). `register.ts` (cli) still populates the dispatch registry; new `register.test.ts` invariant pins that both stay in sync. |
| 2 | `provider fork failed: RPC handler not registered: :fork-spawn-session` | `sessions.machine_id` SQLite column is null on rows created via paths that only stash `machineId` inside `metadata`. Empty machineId routed the RPC to `:fork-spawn-session` (no namespace prefix). | `hubSyncEngineAdapter.getSession` now falls back to `metadata.machineId` when the column is null. New `hubSyncEngineAdapter.test.ts` test pins it. |
| 3 | `fork provider RPC response missing providerSessionId` | `ForkSpawnPayloadSchema` required `newHapiSessionId`, but the controller refactor flows newHapiId out of `spawnSession` *after* the provider call, so the field was never populated and zod parse rejected the payload. The field also wasn't actually used anywhere. | Removed the dead field from schema + provider interface + tests. |
| 4 | `claude fork: timeout waiting for init message after 15000ms` | `claude --fork-session --print` no longer emits `system/init` when stdin is empty (current claude CLI behavior). It does emit `SessionStart` hook lines carrying the forked `session_id`. | Parser now accepts any line whose `session_id` differs from the source. Closed child stdin immediately to break wait-for-prompt loop. |
| 5 | UI: `Process exited unexpectedly: Claude Code process exited with code 1` after fork | `claude --fork-session` materializes the new session's JSONL on disk only after processing at least one user turn. We were SIGTERMing the child as soon as we'd read the session id (no JSONL written), so the launcher's subsequent `claude --resume <new-id>` failed with file-not-found. | Send a minimal `"."` prompt over stdin, then wait for natural process exit (not SIGTERM) before resolving — by the time we resolve, the forked JSONL is fully flushed. |
| 6 | Fork session showed UI text like `session.action.fork` / `dialog.fork.errorTitle` instead of human strings | i18n `t()` implementation ignores `defaultValue:` option; missing keys fall back to the key itself. | Added `session.action.fork`, `dialog.fork.errorTitle`, `dialog.fork.dismiss` to `en.ts` + `zh-CN.ts`. |
| 7 | Fork session title was blank in sessions list | Controller wrote `metadata.title`, but hapi's user-facing session name lives in `MetadataSchema.name` (set by `renameSession` → PATCH `/sessions/:id`). | Write `name` instead of `title`. Test updated. |

## Step-by-step evidence

### Environment

- Dev hub: `bun run --cwd hub start` with `HAPI_HOME=~/.hapi-dev-fork-e2e HAPI_LISTEN_PORT=3106 CLI_API_TOKEN=<dev>`
- Dev web: vite, `VITE_HUB_PROXY=http://127.0.0.1:3106 --port 5173`
- Dev cli runner: `bun run --cwd cli dev runner start-sync` (same env)
- Browser: moat-browser remote session (ws://browser.hb.lan:3000)
- Machine id: `4ec8c36e-5ca2-493e-b7f4-fbdee95675bb` (dev), distinct from production `6c73aa77-...`

### Source session

- hapi id: `38364427-da6b-4375-8ebc-d54def7cc353`
- cwd: `/tmp/hapi-fork-e2e-cwd`
- flavor: `claude`
- claudeSessionId: `3107fecd-dc8a-45c1-8a4d-e38e02d565c8`
- 4 messages (user "Reply with…ORIGINAL" + claude "ORIGINAL")

### Fork API call

```
POST /api/sessions/38364427-da6b-4375-8ebc-d54def7cc353/fork
→ 200 {"newSessionId":"a929409b-85eb-42ef-a4a8-6b180f126e4a"}
```

### DB post-fork (hapi-dev-fork-e2e/hapi.db)

```
=== fork metadata ===
{
  "claudeSessionId": "6db3ad9b-cc5d-416d-b9e0-3e164c06b1cd",  // ≠ source
  "forkedFrom": "38364427-da6b-4375-8ebc-d54def7cc353",       // = source
  "forkedAt": 1782782...,
  "name": "Untitled (fork)",
  "path": "/tmp/hapi-fork-e2e-cwd",
  "flavor": "claude",
  "machineId": "4ec8c36e-5ca2-493e-b7f4-fbdee95675bb"
}
=== message counts ===
source  : 4
fork    : 4   (copied)
=== claude JSONL on disk ===
~/.claude/projects/-private-tmp-hapi-fork-e2e-cwd/6db3ad9b-...jsonl  (67 KB, freshly written)
```

### UI screenshots

- `01-sessions-list-after-fork.jpg` — sessions list shows `Untitled (fork) just now` ahead of `hapi-fork-e2e-cwd` source row.
- `02-fork-session-opened.jpg` — fork session opened, title `Untitled (fork) claude`, message history `Reply with… ORIGINAL` preserved, status `online ctx 4%`.
- `03-fork-replied-FORKED.jpg` — after sending `"Now reply with the single word: FORKED"` in the fork session, claude replied `FORKED`. Both messages visible in fork's transcript.
- `04-original-session-unaffected.jpg` — source session shows only the original two messages (`Reply with…` + `ORIGINAL`). No `FORKED` prompt or reply. Status `offline / This session is inactive`.

### Independence verification

| Property | Source | Fork |
|---|---|---|
| hapi sessionId | `38364427-...` | `a929409b-...` |
| Claude session_id (provider) | `3107fecd-...` | `6db3ad9b-...` |
| Claude JSONL on disk | `3107fecd-...jsonl` | `6db3ad9b-...jsonl` (distinct file) |
| Messages after fork+turn | 4 (unchanged) | 6 (4 copied + 2 new) |
| Lineage | — | `forkedFrom = source hapi id` |
| Display name | `hapi-fork-e2e-cwd` (path) | `Untitled (fork)` |

## What was NOT exercised

- Codex fork (per user direction: "codex 不需要跑，跑 claude 就行"). T20 deferred.
- Active-turn fork rejection — MVP does not check active-turn state; deferred.

## GUI click-path verification (2026-07-05 addendum)

The T19 pass above triggered the final fork via direct `POST /api/sessions/:id/fork` because moat-browser accessibility refs were unstable across snapshots for the virtual-scroll session-list items. This addendum backfills the missing evidence: a user actually clicking the Fork menu item and observing the mutation propagate end-to-end.

Setup: same dev environment (`HAPI_HOME=~/.hapi-dev-fork-e2e`, hub `127.0.0.1:3106`, vite `127.0.0.1:5173`, dev cli runner with independent machineId `4ec8c36e-…`). Browser: moat-browser remote session (`ws://browser.hb.lan:3000`). The virtual-scroll list-item refs still race with timestamp text updates ("just now" → "1m ago" → "2m ago"); worked around with a JS-eval scroll-and-click via `.session-list-item` class rather than Playwright role locators.

**Menu item renders on a Claude source session:**

![Fork menu item in More Actions on a Claude session](https://img.237575.xyz/media/bdRQa77QPKirz03-Scrc_dYMhSA7dgEKcPs-kGDw7sA)

Menu order: `Rename / Session ID / Export conversation / Fork session / Reopen / Delete`. Rendered from the same `useFlavorCapabilities` hook + `SessionActionMenu` wiring paths; capability-gated by `GET /api/flavors/capabilities`.

**Clicking the menu item invokes the mutation, hub log:**

```
<-- POST /api/sessions/38364427-da6b-4375-8ebc-d54def7cc353/fork
<-- POST /cli/machines
--> POST /cli/machines 200 1ms
<-- POST /cli/sessions
--> POST /cli/sessions 200 1ms
--> POST /api/sessions/38364427-da6b-4375-8ebc-d54def7cc353/fork 200 3s
```

The 3s window covers claude fork spawn + JSONL materialization + hub's standard `spawnSession` reuse; the interleaved `/cli/*` POSTs are the runner reporting the new session back through the sync path.

**New fork appears in the sessions list with the correct label:**

![Sessions list post-fork: "Untitled (fork) just now" alongside T19 fork and source](https://img.237575.xyz/media/w4DpkBZvsVv_iogs94XMrKptaql1MwabQbhLqiULBeg)

Header count changes `2 sessions in 1 projects` → `3 sessions in 1 projects`; the new row `Untitled (fork) just now` renders at the top under `tmp/hapi-fork-e2e-cwd`.

**Post-click state verification (2026-07-05 fork):**

| Property | Source `38364427-…` | 2026-07-05 fork `25510cd5-…` |
|---|---|---|
| `metadata.claudeSessionId` | `3107fecd-…` | `d011b225-…` (distinct) |
| `metadata.forkedFrom` | — | `38364427-…` |
| `metadata.forkedAt` | — | `2026-07-05 09:56:16 UTC` |
| `metadata.name` | (default from path) | `Untitled (fork)` |
| On-disk JSONL | `3107fecd-…jsonl` — 12 lines, 62 907 B, md5 `7476be47…` | `d011b225-…jsonl` — 19 lines, 68 756 B, md5 `7d4676e7…` |
| hub `messages` rows | 4 | 4 (transcript cloned) |

Distinct provider session ids, distinct on-disk JSONL files, lineage metadata written — same shape as T19 verified via curl, now re-verified through the GUI-triggered path.

**Env-specific gaps re-hit while reproducing on a new dev env (not PR defects):**

1. Source session's cwd `/tmp/hapi-fork-e2e-cwd` had been GC'd between T19 and this addendum — first click failed with `posix_spawn '/Users/mouriya/.local/bin/claude'` ENOENT before Claude got a chance to run (posix_spawn reports the executable path even when the missing entry is the cwd). Recreated via `mkdir -p /tmp/hapi-fork-e2e-cwd`.
2. `claude` binary here is a symlinked shim (`~/.local/bin/claude → ~/.claude-shim/claude`) whose PATH lookup differs across shells. Set `HAPI_CLAUDE_PATH=/Users/mouriya/.local/bin/claude` on the runner explicitly to sidestep the lookup ambiguity.

Both are environment concerns for reproducing the e2e, not code issues in this PR.

## Live context-inheritance verification (2026-07-05 addendum #2)

The GUI addendum above establishes that fork endpoint fires end-to-end from a real click and produces the correct file / DB shape. The complementary check — **does the fork actually inherit source's conversation context, and does the source stay isolated when the fork advances** — needs a live prompt sent into the fork after `spawnSession`, then Claude's real reply observed. This section captures that.

### Setup for the live probe

- Same dev hub / cli runner as above; 2026-07-05 fork `25510cd5-…` (source `38364427-…`, fork `claudeSessionId d011b225-…`) still live under runner-spawned bun launcher pid 62031.
- Probe driven by `POST /api/sessions/:id/messages` with `Content-Type: application/json` body `{"text": "<prompt>"}`. This is the same endpoint the web mutation `useSessionActions.sendMessage` posts to; skipping the browser here removes vite/moat flakiness from the loop, not the fork feature itself. Same hub, same runner, same launcher — the composer text field is a thin wrapper over this endpoint.

### Probe 1 — does the fork know what the source's user asked for?

```
POST /api/sessions/25510cd5-9c36-47e2-a121-55464c700cf2/messages
{"text":"In one word, what did the user in this conversation ask you to reply with?"}
→ 200 {"ok":true}
```

The only mention of "reply with a single word" lives in the **source** session's user turn (`Reply with just the single word: ORIGINAL`, 2026-06-30, hub message seq=1). The fork was created after that turn. If context inherited, Claude should answer `ORIGINAL`. If not, Claude would refuse for lack of context.

Fork's transcript after 25s (`GET /api/sessions/:id/messages` filtered to seq ≥ 7 — the send + reply pair):

```
seq=7  user  "In one word, what did the user in this conversation ask you to reply with?"
seq=8  agent event/type=ready
seq=9  agent output   text="ORIGINAL"
              model=claude-opus-4-7
              sessionId=d011b225-ab90-48f8-b392-8819cdd1a672   ← fork, not source
              timestamp=2026-07-05T10:28:17.931Z
              msg_id=msg_019BovAwSWEaYuXNkJmWjoHs
              cache_read_input_tokens=16768  cache_creation_input_tokens=44314
              cache_miss_reason=system_changed   ← expected: new session id invalidates cache
```

Claude replied `ORIGINAL`. The reply carries a fresh `msg_id` and the **fork's** `sessionId d011b225-…`, i.e. it is a live turn produced inside the fork's Claude process, not a replay of source's cached reply. This is context inheritance in the direction that matters: the fork's Claude has the source's turns in its resume state and uses them to answer.

### Probe 2 — is the source unaffected by the fork's new turn?

Same runner, same hub, source is `active=false / inactive`. If fork's activity leaked back, either source's hub message count or its Claude JSONL would grow.

Live counts after probe 1 completed:

| Property | source `38364427-…` (`3107fecd-…jsonl`) | fork `25510cd5-…` (`d011b225-…jsonl`) |
|---|---|---|
| hub `messages` rows | **4** (unchanged from before fork) | 9 (4 copied + probe user + retry user + fork's assistant turns) |
| on-disk JSONL lines | **12** (unchanged) | 25 (grew from 19 → 25 with fork's `.` primer + probe reply + resume markers) |

Source is not polluted by fork's new user prompt or Claude reply — neither in the hub messages table nor in Claude's own JSONL. Fork advanced independently.

### What this addendum #2 changes vs #1

Addendum #1 only observed the fork's on-disk shape (`d011b225` JSONL exists, distinct md5, hub row has lineage metadata). It didn't drive a live turn through the fork's Claude launcher, so it couldn't distinguish "fork looks right on disk" from "fork actually behaves like an inherited-context session in a real Claude process." Probe 1 in #2 forces Claude to demonstrate it has the source's context and answer from it; Probe 2 forces the reverse independence check. Together they cover the two directions of what "fork" means at the user-value level.

### Runner startup note (not a PR issue)

Reproducing the live probes required restarting the hub bun process — an earlier probe at 19:15 UTC returned `Process exited unexpectedly: Claude Code process exited with code null` because bun's JS runtime was in a transient bad state on this machine (fresh `bun -e "1+1"` also returned `error: An unknown error occurred (Unexpected)` at the same time; the same command worked again a minute later). Restarted hub, re-sent the same probe, got `ORIGINAL`. Not a code path in this PR.
