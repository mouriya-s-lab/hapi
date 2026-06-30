# Trunk patches owned by fork-features

These edits land in upstream files because no upstream register API exists.
Each rebase: re-read the corresponding upstream file, re-apply if conflicting,
remove if upstream provided a native register API or the feature is obsolete.

Rule reference: `~/.claude/rules/fork-customization-placement.rule.md`.

## session-fork (2026-06-28)

End-to-end session fork feature. Most logic lives in
`fork-features/session-fork/`; the table below is what's necessarily
in upstream files because the surrounding system needs the hook.

| # | File | What it does | Lines |
|---|---|---|---|
| 1 | `shared/src/schemas.ts` | Add `forkedFrom?: string`, `forkedAt?: number` optional fields to `MetadataSchema` so fork lineage survives sync. | ~3 |
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

Total: 17 files, ~225 lines of trunk patch (the bulk in (15)/(16)/(17) which
are pure UI integration). Everything load-bearing is in
`fork-features/session-fork/`.

## Verification record

| Date | Operation | Result |
|---|---|---|
| 2026-06-28 | Initial implementation (T1–T17 of `docs/superpowers/plans/2026-06-28-session-fork.md`) | All 52 fork-features unit tests + 12 web unit tests pass. Repo typecheck (cli + hub + web) clean. E2E verification (T19/T20) and sync-upstream dry-run (T21) pending. |
| 2026-06-30 | T19 — Claude end-to-end on dev hub + dev cli runner | Pass. 7 bugs found and fixed during e2e (capability-list/registry split, machineId fallback, dead newHapiSessionId field, claude session_id parser, fork JSONL materialization via minimal prompt, i18n keys, metadata.name vs title). 53 fork-features tests + repo typecheck still green. Evidence: `docs/superpowers/evidence/2026-06-28-session-fork-claude/`. |
| 2026-06-30 | T21 — upstream/main rebase dry-run (`upstream/main` = `b44885a`, 5 commits ahead of fork point `2ab3b39`) | Of 17 trunk-patch files, 4 touched by upstream in this delta: `shared/src/schemas.ts`, `hub/src/sync/syncEngine.ts`, `web/src/components/SessionList.tsx` — all in different regions from our patches (no hunk conflict). One **hunk conflict** at `cli/src/api/apiMachine.ts:25` — both branches add a +1 import line to the same import block; resolution is trivial (keep both). Baseline fork conflicts unrelated to session-fork (omp on `shared/src/flavors.ts` etc.) persist as expected. |
