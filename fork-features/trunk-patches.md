# Trunk patches owned by fork-features

These edits land in upstream files because no upstream register API exists.
Each rebase: re-read the corresponding upstream file, re-apply if conflicting,
remove if upstream provided a native register API or the feature is obsolete.

Rule reference: `~/.claude/rules/fork-customization-placement.rule.md`.

## multi-user gateway (2026-07-16)

Account, API-token, ownership, grant, authorization, cross-namespace routing,
notification fanout, and the admin UI live in `fork-features/multi-user/` or
`web/src/fork-features/multi-user/`. HAPI's core store and domain model remain
unchanged. The following upstream-owned files contain only integration hooks
because the hub and web app do not expose registration APIs for these seams.

| File | Necessary hook |
|---|---|
| `hub/src/startHub.ts` | Construct the gateway store and adapters; inject CLI, terminal, notification, and web dependencies. |
| `hub/src/web/server.ts` | Mount gateway routes, aggregate execution routes, and the resource authorization middleware. |
| `hub/src/web/routes/cli.ts` | Resolve gateway API tokens to a core namespace for runner HTTP registration. |
| `hub/src/socket/server.ts`, `hub/src/socket/socketTypes.ts` | Accept namespace resolvers for gateway-authenticated CLI and terminal sockets. |
| `hub/src/socket/handlers/terminal.ts` | Replace the authenticated account namespace with the dispatcher's authorized resource namespace. |
| `hub/tsconfig.json` | Include the fork-owned hub modules in the strict TypeScript program. |
| `web/src/App.tsx`, `web/src/router.tsx` | Mount the fork-owned login/admin screens and admin route. |
| `web/src/components/LoginPrompt.tsx` | Re-export the fork-owned login component at the existing upstream import seam. |
| `web/src/api/client.ts` | Send the gateway login shape and expose gateway administration requests. |
| `web/src/hooks/useAuth.ts`, `web/src/hooks/useAuthSource.ts`, `web/src/lib/app-context.tsx` | Preserve gateway account identity and refresh it through the existing auth context. |
| `package.json`, `bun.lock` | Make the fork-owned root modules' Hono dependency resolvable. |

Each upstream synchronization must remove a hook if upstream gains an
equivalent registration seam or native multi-user gateway.

## session-fork (2026-06-28)

End-to-end session fork feature. Most logic lives in
`fork-features/session-fork/`; the table below is what's necessarily
in upstream files because the surrounding system needs the hook.

| # | File | What it does | Lines |
|---|---|---|---|
| 1 | `shared/src/schemas.ts` | Add `forkedFrom?: string`, `forkedAt?: number`, `forkedFromMessageId?: string` optional fields to `MetadataSchema` so fork lineage (including per-message fork target from #57 c1) survives sync. | ~4 |
| 2 | `shared/src/rpcMethods.ts` | Add `RPC_METHODS.ForkSpawnSession = 'fork-spawn-session'`. | 1 |
| 3 | `cli/src/index.ts` | Side-effect import `'../../fork-features/session-fork/register'` at cli startup so the Claude + Codex fork providers are in the registry before RPC dispatch. | 4 (incl. comment) |
| 4 | `cli/tsconfig.json` | `rootDir` set to `..` and `../fork-features/**/*.ts` added to `include` so cli's TS program can typecheck imports into fork-features. | 4 |
| 5 | `cli/src/api/apiMachine.ts` | Import + register `RPC_METHODS.ForkSpawnSession` handler inside `setRPCHandlers()`, immediately after `StopRunner`. Delegates to `handleForkSpawnSession` in fork-features. | 5 |
| 6 | `cli/src/codex/appServerTypes.ts` | Add `ThreadForkParams` + `ThreadForkResponse` interfaces. Codex app-server exposes `thread/fork` natively; this just gives us types. | ~13 (incl. doc) |
| 7 | `cli/src/codex/codexAppServerClient.ts` | Import the new types + add public `forkThread(params, options?)` method mirroring `startThread`/`resumeThread` shape. Required because `sendRequest` is private. | ~10 |
| 8 | `hub/src/sync/rpcGateway.ts` | Add public `forkProviderSessionOnMachine(machineId, request)` wrapping the private `machineRpc` for `RPC_METHODS.ForkSpawnSession`. Single-method exposure, no broader API surface change. | ~12 |
| 9 | `hub/src/sync/syncEngine.ts` | Add public `forkProviderSession(machineId, request)` wrapping `rpcGateway.forkProviderSessionOnMachine` for `hubSyncEngineAdapter` to consume. | ~10 |
| 10 | `hub/src/store/index.ts` | Add `runInTransaction<T>(fn): T` helper on Store class so fork-bound DB writes can be wrapped atomically without exposing the raw `db`. **Currently unused by forkController** (the refactored controller doesn't need a tx because spawnSession + copyMessages + updateMetadata are independent best-effort), but kept as a generic primitive for future tx-bound fork operations. | ~10 |
| 11 | `hub/src/web/server.ts` | Import `mountForkRoutes` + `buildForkDeps` from fork-features; mount routes after the existing `app.route('/api', …)` calls. Adapter receives per-request namespace from Hono ctx. | ~10 |
| 12 | `hub/tsconfig.json` | `rootDir` set to `..` and narrow include of the four hub-side fork-features files (excludes `cliHandler.ts`/`register.ts`/`providers/**` that pull cli `@/*` paths). | ~10 |
| 13 | `web/src/api/client.ts` | Add `forkSession(sessionId)` + `getFlavorCapabilities()` methods to `ApiClient`, slotted alongside `reopenSession`. | ~16 |
| 14 | `web/src/hooks/mutations/useSessionActions.ts` | Add `forkSession` field to the return-type interface + matching `useMutation` + `forkMutation.isPending` in the aggregate `isPending`. | ~17 |
| 15 | `web/src/components/SessionActionMenu.tsx` | Optional `onFork?` + `forkSupported?` props + `handleFork` + a Fork menu item rendered above Archive when both are truthy + new `ForkIcon`. | ~40 |
| 16 | `web/src/components/SessionHeader.tsx` | Wire `useFlavorCapabilities` + `forkSession` mutation; pass `onFork` + `forkSupported` to `SessionActionMenu`; expose `onSessionForked` callback prop; inline error dialog. | ~30 |
| 17 | `web/src/components/SessionList.tsx` | Same wiring inside `SessionItem`; `onFork` navigates via existing `onSelect` after fork; inline error dialog. | ~30 |
| 18 | `web/src/hooks/queries/useFlavorCapabilities.ts` | New file under upstream hooks dir. React Query hook fetching `/api/flavors/capabilities`. Originally added by session-fork; expanded by #57 c1 to a two-dim `FlavorForkCapability` shape (fork: none/head-only/at-message, files: none) plus `getFlavorForkCapability` accessor. Consumed by SessionList/SessionHeader/UserMessage to gate the Fork menu / message-level rewind button. | ~40 |
| 19 | `web/src/hooks/queries/useFlavorCapabilities.test.tsx` | Companion test file for (18). Kept alongside the hook because the web test convention nests `*.test.tsx` beside its subject. | ~50 |
| 20 | `web/src/components/AssistantChat/messages/UserMessage.tsx` | Add rewind button in the trailing action row that is capability-gated on `getFlavorForkCapability(...).fork === 'at-message'`, wire it through `useSessionActions.forkSession({forkPoint:{messageId}})`, stash source text via `setForkedFromText`, then navigate to `/sessions/$sessionId`. Placement in upstream file because the message bubble is upstream-owned and there is no per-role render register API — a fork-features side extraction would still need to hook this exact JSX slot. | ~35 |
| 21 | `web/src/hooks/useComposerDraft.ts` | Consume any one-shot fork-restore text (from #62 c5) before checking the draft; if hit, `clearDraft` + `setText` and skip the draft path. Fork-restore takes precedence because the new session id is brand-new and any draft under it is either empty or stale-from-a-prior-fork — the rewound source text is the intended prefill. Placement in upstream file because the timing constraint requires both branches to share the same rAF callback (two sibling hooks would race on committing `setText` before the composer marks itself dirty). | ~10 |

Total: 21 files, ~360 lines of trunk patch (the bulk in (15)/(16)/(17)/(20) which
are pure UI integration). Everything load-bearing is in
`fork-features/session-fork/`.

The following live under `fork-features/` in shape but reside physically under
`web/src/` because they participate in the web module graph and Vite
bundling (aliases only resolve inside `web/src/`):
- `web/src/lib/fork-restore.ts` (+ companion `.test.ts`) — one-shot sessionStorage
  handoff feeding #63 c6 composer restore. Purely additive; not counted as
  trunk patch because it does not modify upstream files.
- `web/src/components/AssistantChat/messages/UserMessage.test.tsx` — companion
  test for (20). Same as (19): web test convention nests `*.test.tsx` beside
  its subject.
- `web/src/hooks/useComposerDraft.forkRestore.test.ts` — separate test file
  next to the upstream `useComposerDraft.test.ts` covering only the
  fork-restore branch. Deliberately not merged into the upstream test file
  so a rebase over upstream changes to `useComposerDraft.test.ts` doesn't
  fight our added cases.

## bob-fork-customizations (2026-07-06)

Five behavior tweaks selectively imported from `bobmcmxciv/hapi@1a6684d5` after
review. Original commit bundled 14-file squash spanning three unrelated
concerns; this fork imports only the five that solve real gaps here, drops
the two that were security-semantic changes disguised as "supporting edits"
(CLI `ReadFile` widening to `os.tmpdir()`, hub `PATCH /machines/:id` rename),
and drops the download-button variant that this fork already implemented.

The Read-tool image detection helper lives in its own file
(`web/src/components/ToolCard/views/readImageDetection.ts`) so `_results.tsx`
only receives an import + one dispatch line — web-side "fork-features"
equivalent (web/tsconfig doesn't include `fork-features/`, matching the
session-fork precedent for web-side integrations).

| # | File | What it does | Lines |
|---|---|---|---|
| 1 | `shared/src/sessionSummary.ts` | Add optional `host?: string` to `SessionSummaryMetadata` and pass through `session.metadata.host` in `toSessionSummary`. Underlying `MetadataSchema.host` is already required; this just projects it into the summary that sidebars consume. | 2 |
| 2 | `web/src/components/assistant-ui/markdown-text.tsx` | `denyOnlyTransform` short-circuits `data:image/*` (previously stripped; noted as "FIX 5, deferred" in the original comment). Only image data URIs are let through — `data:text/html` still falls through to classifyScheme. Comment block rewritten to describe current behavior (per `no-legacy-content-in-docs`). | ~3 code + comment refresh |
| 3 | `web/src/components/AssistantChat/HappyComposer.tsx` | `handleKeyDown` gate expanded from `isComposing` to `isComposing \|\| keyCode === 229` so Safari / some IMEs don't leak IME-confirmation Enter into a message-send. | 1 code + comment |
| 4 | `web/src/components/SessionList.tsx` | `resolveMachineLabel` gets a second fallback tier: `machineLabelsById → hostByMachineId (built from session metadata) → machineId.slice(0,8)`. New `useMemo` builds the map from `props.sessions`. | ~14 |
| 5 | `web/src/components/ToolCard/views/_results.tsx` | Two imports (`ImagePreview`, `detectImageDataUrl`) + a leading early-return in `renderReadTextResult` that renders an inline `<ImagePreview>` when the Read tool payload is base64 image bytes. All detection logic lives in the sibling `readImageDetection.ts`. | ~15 |
| 6 | `web/src/lib/remark-file-path-links.ts` | Extension whitelist gets `csv/doc/docx/gz/log/pdf/ppt/pptx/tar/xls/xlsx/zip`. `PATH_PATTERN` extended to recognize `~/`, `/`, `C:\`, `foo\` (Windows) prefixes. `shouldLinkPath` drops the "reject absolute paths" tier. `linkTextNode` gains a URL-prefix lookback (any `://` in the current whitespace token → skip). **Behavior turn:** the fork's original `remark-file-path-links.test.ts` asserted that absolute paths must NOT link ("outside session workspace"); test file updated to the new semantics (link the path — file-page RPC will separately gate whether it can be read). | ~10 code |

Total: 6 files, ~45 lines of trunk patch, plus 1 new fork-owned helper file
under `web/src/components/ToolCard/views/`.

## Verification record

| Date | Operation | Result |
|---|---|---|
| 2026-06-28 | Initial implementation (T1–T17 of `docs/superpowers/plans/2026-06-28-session-fork.md`) | All 52 fork-features unit tests + 12 web unit tests pass. Repo typecheck (cli + hub + web) clean. E2E verification (T19/T20) and sync-upstream dry-run (T21) pending. |
| 2026-06-30 | T19 — Claude end-to-end on dev hub + dev cli runner | Pass. 7 bugs found and fixed during e2e (capability-list/registry split, machineId fallback, dead newHapiSessionId field, claude session_id parser, fork JSONL materialization via minimal prompt, i18n keys, metadata.name vs title). 53 fork-features tests + repo typecheck still green. Evidence: `docs/superpowers/evidence/2026-06-28-session-fork-claude/`. |
| 2026-06-30 | T21 — upstream/main rebase dry-run (`upstream/main` = `b44885a`, 5 commits ahead of fork point `2ab3b39`) | Of 17 trunk-patch files, 4 touched by upstream in this delta: `shared/src/schemas.ts`, `hub/src/sync/syncEngine.ts`, `web/src/components/SessionList.tsx` — all in different regions from our patches (no hunk conflict). One **hunk conflict** at `cli/src/api/apiMachine.ts:25` — both branches add a +1 import line to the same import block; resolution is trivial (keep both). Baseline fork conflicts unrelated to session-fork (omp on `shared/src/flavors.ts` etc.) persist as expected. |
| 2026-07-05 | Rebase PR #56 onto `origin/main` HEAD `656d767` after main advanced past PR base `1ade69d` (Merge PR#53 sync/merge, PR#54 sync/review, plus `26a24bb` machine health + `5ade952` cursor ACP fix already inbound). 4 of 17 trunk-patch files intersect main's delta: `cli/src/api/apiMachine.ts`, `hub/src/sync/syncEngine.ts`, `shared/src/schemas.ts`, `web/src/components/SessionList.tsx`. Auto-merge resolved 3 (different regions). One hunk conflict at `cli/src/api/apiMachine.ts` import block: our `handleForkSpawnSession` import vs main's new `collectMachineHealth` import — resolved keep-both, exactly the T21 dry-run prediction. Post-rebase: `cli/hub/web` typecheck clean, `bun test fork-features/` 53/53 pass. |
| 2026-07-06 | #57 c1 (issue #58) — shared contract for per-message fork. Edits: (1) forkedFromMessageId added to trunk patch #1; (18)/(19) new entries for useFlavorCapabilities.ts/.test.tsx (upstream-dir hook files formerly unregistered from #55); patched #13/#16/#17 for new two-dim capability shape (`{capabilities: {flavor: {fork, files}}}` instead of `{fork: string[]}`). Non-trunk: forkCapabilities.ts converted from boolean allow-list to static map + accessors; rpcPayloads.ts gained `forkPoint {messageId, tailOffset}`; hubMount returns full map; hubForkController swaps `FORK_CAPABLE_FLAVORS.includes` for `isForkCapableFlavor`. Test outcome: `bun test fork-features/` 65/65 pass (was 53, +12 for forkCapabilities.test.ts + expanded rpcPayloads.test.ts); web 1162/1162; hub 467/467 (3 pre-existing skip); shared 110/110. Full `bun run typecheck` (cli+web+hub) clean. `git grep FORK_CAPABLE_FLAVORS` returns nothing (acceptance #10). |
| 2026-07-06 | #57 c5 (issue #62) — web user-message rewind button. Edits: new trunk patch #20 (UserMessage.tsx: RewindIcon + capability-gated button + handleRewind → forkSession → setForkedFromText → navigate). Existing trunk patches touched: #13 (`web/src/api/client.ts` gains `forkPoint?` opts on `forkSession`), #14 (`useSessionActions.ts` fork mutation accepts `{forkPoint?}` arg). Non-trunk additions: `web/src/lib/fork-restore.ts` (one-shot sessionStorage handoff feeding #63 c6) + its `.test.ts`; `web/src/components/AssistantChat/messages/UserMessage.test.tsx` (7 cases: 4 capability-gating, 1 click flow, 1 empty-text-no-stash, 1 pending-disables). Test outcome: `bun test fork-features/` 87/87 pass; web 1176/1176; hub 467/470 (3 pre-existing skip); shared 110/110. Full `bun run typecheck` clean. |
| 2026-07-06 | #57 c6 (issue #63) — composer restore from fork-restore text. Edits: trunk patch #21 (useComposerDraft.ts): consumeForkedFromText check in the same rAF callback BEFORE the getDraft path; on hit → clearDraft + setText. Non-trunk: new `web/src/hooks/useComposerDraft.forkRestore.test.ts` (5 cases: hit-prefills+skips-draft, miss-falls-back-to-draft, does-not-overwrite-existing-text, normal-unmount-save-after-consume, sessionId-undefined-no-op). Existing `useComposerDraft.test.ts` unchanged (6/6 still green — real fork-restore returns null with empty sessionStorage). Test outcome: `bun run test:web` 1181/1181 pass; `bun test fork-features/` 87/87 unchanged; hub 467/470; shared 110/110. Full `bun run typecheck` clean. |
