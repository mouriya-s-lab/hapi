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
