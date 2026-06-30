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
- UI menu-click path: moat-browser refs were unstable across re-snapshots, so the final fork was triggered via direct `POST /api/sessions/:id/fork`. The UI menu wiring (`useFlavorCapabilities` → `useSessionActions.forkSession` mutation → `/api/sessions/:id/fork`) was exercised through the same endpoint indirectly. The menu item visibility was verified in the snapshot before invocation (`menuitem "session.action.fork"`).
- Active-turn fork rejection — MVP does not check active-turn state; deferred.
