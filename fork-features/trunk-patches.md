# Trunk patches owned by fork-features

These edits land in upstream files because no upstream register API exists.
Each rebase: re-read the corresponding upstream file, re-apply if conflicting,
remove if upstream provided a native register API or the feature is obsolete.

Rule reference: `~/.claude/rules/fork-customization-placement.rule.md`.

## Classified fork-specific fixes and small features (2026-07-18)

`fork-features/upstream-fix-dispositions.tsv` is the path-level source of
truth for issue #179. General fixes remain `upstream-fix` and link their
upstream issue. The rows below are the paths that cannot be contributed as a
standalone general fix because they carry fork-specific behavior.

| Files | Missing upstream seam | Why it cannot move out | Runtime path | Sync verification |
|---|---|---|---|---|
| `.github/workflows/release.yml`, `web/vite.config.ts`, `web/src/types/global.d.ts` | No fork build-metadata or release-policy provider | Release inputs and compile-time changelog constants are consumed directly by upstream-owned workflow/Vite entrypoints | release env → Vite define → settings/update banner | Build web with fork release env and inspect rendered version/changelog; inspect release job graph |
| `cli/src/codex/codexRemoteLauncher.ts`, `codexEventConverter.ts` and tests; `web/src/chat/normalize.test.ts`, `presentation.ts`, `SystemMessage.tsx` | No Codex compact-summary event/renderer registry | Compact events must traverse the existing launcher, normalized chat ADT, and system-message renderer | Codex compact event → normalized expandable system message | Trigger real Codex compaction/retry and expand the resulting summary; re-run linked upstream retry issues |
| `cli/src/grok/grokRemoteLauncher.ts` | No flavor launcher conflict-resolution registry | The upstream launcher is the dispatch implementation; the fork keeps only the resolved Grok-specific delta | Grok session start → launcher → ACP backend | Start a real Grok session after every upstream sync |
| `shared/src/sessionSummary.ts`, `SessionAttentionIndicator.tsx`, `sessionAttention.ts` and tests | No session-summary field/provider registry | Fork archive visibility and ready-attention data must cross the shared summary boundary and existing list renderer | archive/ready update → session summary → filtered list/attention dot | Archive/unarchive and ready-state transitions in a real session list |
| `PwaUpdateBanner.tsx` and test | No PWA update-banner content slot | Fork changelog content is rendered inside the existing upstream update lifecycle component | service-worker update → update banner → version/changelog details | Build two versions, trigger update, expand changelog, then reload |
| `markdown-text.tsx`, `remark-file-path-links.ts` and tests, `routes/sessions/file.test.tsx` | No Markdown plugin/file-view behavior registry | Imported fork Markdown/file-path behavior must be installed in the upstream-owned renderer and file route | assistant/file Markdown → path link/plugin → workspace file route | Render a real path link, open it, edit/save/download, then refresh |
| `mermaid-diagram.live.test.tsx`, `mermaid-diagram.test.tsx`, `icons.tsx` | No Mermaid control/icon registration seam | Fork zoom behavior and Qwen playback share the upstream-owned icon/diagram surfaces | Mermaid render → zoom controls; assistant reply → summary playback control | Render real Mermaid, zoom/reset/close; play a real generated reply summary |
| `reasoning.tsx` | No reasoning-group renderer registry | Sticky collapse state wraps the upstream reasoning renderer and must remain adjacent to its lifecycle | streamed reasoning → expanded/collapsed group → sticky control | Stream reasoning, scroll, collapse/expand, and refresh |
| `sessionResume.ts` and test | No resume-metadata field registry | The fork session-ID affordance reads the native resume token from the upstream resume helper | session menu → Session ID dialog → copy | Open a real session menu and copy the displayed native ID |

Every upstream sync must compare these groups with the path-level disposition
ledger and the linked upstream issues. Remove a patch when upstream absorbs
the fix or exposes a registration seam; do not retain both implementations.

## Long message and tool-result collapsing (2026-07-18)

The shared threshold, measurement, fade, and expand/collapse state live in
the fork-owned `web/src/components/CollapsibleContent.tsx`. Upstream message,
code, CLI-output, and tool-card renderers expose no content-wrapper registry,
so they retain only typed mount hooks and adjacent behavior tests.

| Files | Missing upstream seam | Why it cannot move out | Runtime path | Sync verification |
|---|---|---|---|---|
| `web/src/components/AssistantChat/messages/AssistantMessage.tsx`, `UserMessage.tsx`, `user-bubble.tsx` and test | No assistant/user message content-wrapper registration API | Long-message policy must wrap the existing Markdown/user-bubble render output while preserving streaming and message actions | Normalized message → message renderer → CollapsibleContent → expand/collapse | Stream short and long assistant/user messages, expand/collapse, then refresh |
| `web/src/components/CliOutputBlock.tsx`, `CodeBlock.tsx` and tests | No CLI/code output decorator registry | These renderers own line layout, copy actions, and syntax output; a sibling cannot wrap them without one explicit mount | CLI/code block → measured content → collapsed or full render | Render short and long CLI/code results and verify copy/content fidelity |
| `web/src/components/ToolCard/ToolCard.tsx`, `ToolGroupCard.tsx` | No tool-card body/artifact wrapper registry | Tool lifecycle headers and grouped artifacts must remain outside the collapsible body while long textual results share one policy | Tool result reduction → card/group body → CollapsibleContent | Produce a long real tool result, expand/collapse, and verify grouped artifacts remain visible |

Every upstream sync must re-check for native message/content decorators and
tool-result renderer registration. If a seam exists, self-register the
fork-owned wrapper and remove the corresponding trunk hook.

## Workspace file browser and editor (2026-07-18)

File-view preferences, Markdown/content toggles, preview classification, and
browser E2E fixtures are fork-owned modules. The existing machine RPC and
Web file surfaces expose no action or viewer registration API, leaving these
minimum integration hooks.

| Files | Missing upstream seam | Why it cannot move out | Runtime path | Sync verification |
|---|---|---|---|---|
| `cli/src/api/apiMachine.test.ts` | No machine file-RPC handler registry | Directory creation, write, and download must remain covered at the closed machine RPC boundary used by the hub | Web file action → hub → machine RPC → workspace filesystem | Create a directory/file and persist an edit through a real runner |
| `web/package.json` | No external E2E fixture/script registration surface | Browser fixtures and their Playwright entrypoints must be resolvable by the Web workspace package | Web test command → fixture bundle → browser assertions | Run the file-viewer E2E suite after dependency changes |
| `web/src/components/ToolCard/views/WriteView.tsx`, `_results.tsx`, `_results.test.tsx` | No tool-result viewer registry | Write/read tool results need one dispatch hook into the fork-owned preview classifier without duplicating the tool-card reducer | Tool result → preview classification → text/Markdown/media/file view | Open a real tool-produced file and verify ordinary results remain ordinary |
| `web/src/components/WorkspaceBrowser.tsx` | No workspace action/toolbar registration API | New-folder and copy-path actions must use the existing selected-directory state and browser refresh lifecycle | Workspace browser → create/copy action → machine RPC → refreshed tree | Create nested directory/file and copy the exact path in the browser |
| `web/src/components/assistant-ui/mermaid-diagram.tsx` | No Markdown renderer-extension registry for file preview | Mermaid preview uses the existing assistant Markdown provider; parallel mounting would duplicate theme and lightbox state | Markdown file → preview renderer → Mermaid diagram | Preview a Markdown file containing Mermaid and switch raw/rendered modes |
| `web/src/routes/sessions/file.tsx` | No file-route tab/action/provider registry | Edit, save, download, raw/preview mode, and route refresh share the existing file query and navigation state | File route → edit/save/download mutation → runner filesystem → refreshed query | Edit, refresh, re-read persisted bytes, then download and compare |

Every upstream sync must re-check for native workspace-action, tool-viewer,
Markdown-renderer, and file-route extension APIs and remove hooks when those
seams become available.

## Generated artifact files (2026-07-18)

Artifact discovery, validation, storage, and socket-limit constants live in
the fork-owned `cli/src/modules/common/generatedFiles.ts` and
`shared/src/socketLimits.ts`. The following closed transport, hub, shared,
and Web surfaces have no artifact registration or render-extension seam.

| Files | Missing upstream seam | Why it cannot move out | Runtime path | Sync verification |
|---|---|---|---|---|
| `cli/src/claude/utils/startHappyServer.ts` and test, `systemPrompt.ts` | No MCP tool/prompt contribution registry | Claude must expose the typed send-file tool through its existing MCP server and tell the agent when to use it | Claude prompt → HAPI send_file MCP → artifact registration → session message | Send text and binary files from a real Claude session |
| `cli/src/codex/happyMcpStdioBridge.ts`, `utils/buildHapiMcpBridge.ts` and tests, `codexMcpConfig.test.ts`, `systemPrompt.ts` | No Codex MCP bridge/tool registration API | The same send-file contract must cross Codex's stdio bridge and generated MCP config without a second protocol | Codex tool call → stdio bridge → artifact registration → session message | Send a generated file from a real Codex session |
| `cli/src/modules/common/handlers/files.ts`, `permission/BasePermissionHandler.ts`, `opencode/utils/systemPrompt.ts` | No file-handler, permission-result, or flavor prompt extension registry | Artifact metadata must be emitted separately from ordinary tool results and retain permission behavior | Agent file/result → handler/permission boundary → generated-file message | Render an artifact and an ordinary tool result in one live conversation |
| `hub/src/socket/socketLimits.ts` and test, `hub/src/web/routes/git.ts` and test, `shared/package.json` | No socket payload-limit or authenticated artifact-download route registry | Binary payload size validation and protected download must live at the existing socket/web boundary; the shared workspace must expose the limit contract | CLI upload → socket size gate → persisted artifact → authenticated download | Download byte-identical text/binary files; reject unauthenticated access |
| `web/src/chat/normalizeAgent.ts`, `reconcile.ts`, `reducerTimeline.ts`, `types.ts` | No chat-block variant/reducer registration API | Generated files are a distinct ADT variant that must survive normalization, reconciliation, and timeline ordering | generated-file message → normalized block → reconciled timeline → file card | Verify ordering beside text, tool, image, and video blocks |
| `web/src/components/AssistantChat/messages/MessageAttachments.tsx`, `ToolMessage.tsx`, `web/src/lib/assistant-runtime.ts`, `sessionExport/markdown.ts` | No attachment/card/runtime/export renderer registry | Authenticated preview/download and export links occupy closed rendering slots; parallel rendering would duplicate message state | File block → authenticated fetch → preview/download/export | Preview text, download binary, and export the same conversation |

Every upstream sync must re-check for native MCP contribution, artifact
message, authenticated-download, and chat-render extension APIs and remove
hooks superseded upstream.

## Inline generated media (2026-07-18)

Media validation/registration and Web MIME labeling live in the fork-owned
`cli/src/modules/common/generatedImages.ts` and
`web/src/lib/generatedInlineMedia.ts`. Upstream agent transports and render
reducers expose no generated-media registration/dispatch API, so they retain
the following narrow hooks.

| Files | Missing upstream seam | Why it cannot move out | Runtime path | Sync verification |
|---|---|---|---|---|
| `cli/src/agent/backends/acp/AcpMessageHandler.ts`, `AcpSdkBackend.ts` and companion test | No ACP content-block converter registration API | ACP image blocks must be asynchronously registered before the turn boundary while preserving text/tool ordering | ACP notification → media registration → generated-image agent event → hub message | Display a local image from an ACP-backed live session and verify ordering |
| `cli/src/agent/messageConverter.ts`, `messageConverter.test.ts`, `agent/types.ts` | No external agent-message variant registry | The generated-image variant must remain typed and exhaustive across agent events and HAPI wire messages | Flavor event → AgentMessage ADT → generated-image wire payload | Exercise image and video payloads and inspect the persisted message variant |
| `cli/src/cursor/cursorAcpRemoteLauncher.ts`, `kimi/kimiRemoteLauncher.ts`, `opencode/opencodeRemoteLauncher.ts` | No flavor event-converter callback registry | Each closed launcher switch must forward its generated-image variant without duplicating media registration | Flavor-native event → launcher switch → session message | Trigger supported media from every available live flavor during sync review |
| `cli/src/modules/common/generatedImages.ts`, `generatedImages.test.ts` | Shared CLI module path is upstream-owned and no extra-root module mount exists | All transports need one bounded in-memory media store and MIME/content validation; relocating it outside the CLI program would require a tsconfig/root import patch | Local path or ACP block → signature validation → bounded store → image fetch RPC | Display real PNG/MP4 and reject ordinary text renamed as media |
| `web/src/components/ToolCard/ToolGroupCard.test.tsx` | Tool-result grouping has no external media-artifact test registry | The render reducer must continue treating generated media as an artifact without swallowing ordinary tool results | Persisted tool group → artifact reduction → inline media card and ordinary result | Browser-render media and a non-media tool result in the same live conversation |

Every upstream sync must re-check for native content-converter, message
variant, launcher callback, and render-artifact extension APIs; remove the
corresponding hook when an upstream seam exists.

## Claude custom-model and resume policy (2026-07-18)

HAPI's upstream Claude launcher, persisted session record, shared model
catalog, and Web composer expose no external policy/selector registration
surface. The fork therefore keeps the following typed hooks at their owning
lifecycle boundaries while keeping hook-settings helpers separately tested.

| Files | Missing upstream seam | Why it cannot move out | Runtime path | Sync verification |
|---|---|---|---|---|
| `cli/src/agent/sessionFactory.ts` and test, `cli/src/api/api.ts`, `cli/src/api/apiSession.test.ts`, `cli/src/api/api.extraHeaders.test.ts` | No launch-policy or session-header callback registry | Concrete model/provider choices must enter the exact Claude child-process construction and authenticated session update path | Web create/resume → runner args/session factory → Claude process → hub metadata | Create and resume live Claude sessions with concrete model/provider selections |
| `cli/src/claude/model.test.ts`, `cli/src/commands/resume.test.ts`, `cli/src/modules/common/hooks/generateHookSettings.ts` | No model-parser, resume-preflight, or hook-settings extension seam | Invalid combinations must be rejected before launch while valid model/provider data is preserved in generated hooks and resume arguments | Resume command → validation → hook settings → Claude launch | Resume with original model/provider, then another valid model, and reject an invalid value |
| `hub/src/store/index.ts`, `hub/src/store/sessionStore.ts`, `hub/src/store/types.ts` | No persisted-session field projection registry | Resume policy needs the same durable model/provider record read by hub restart and inactive-session flows | CLI metadata → SQLite session row → inactive session read → resume request | Restart hub before resume and verify model/provider survive |
| `hub/src/notifications/notificationHub.test.ts`, `hub/src/serverchan/channel.test.ts`, `hub/src/sync/messageService.test.ts`, `hub/src/telegram/sessionView.test.ts` | Notification/session views have closed session projection fixtures | The model/provider additions change the shared session product consumed by these boundaries; companion fixtures must remain exhaustive | Persisted session → message/notification projections → external view | Run full hub suite and inspect a live resumed session notification path |
| `shared/src/models.ts`, `shared/src/models.test.ts` | No cross-package Claude model catalog extension registry | CLI and Web must validate and display the same concrete identifiers; a runtime-only sibling catalog would split the contract | Web selection → shared model value → CLI launch argument | Select every supported concrete model and confirm exact ID reaches CLI metadata |
| `web/src/components/AssistantChat/HappyComposer.tsx`, `claudeModelOptions.ts` and adjacent tests, `modelOptions.test.ts`, `web/src/components/NewSession/types.ts` and test | No composer/new-session model-selector provider slot | Create and resume controls live in existing closed form/composer state and must preserve provider/model together | New Session or inactive composer → selector → create/resume mutation → session navigation | Browser-create with a concrete model, resume unchanged, then resume with another valid model |
| `web/src/components/assistant-ui/markdown-a.test.tsx`, `web/src/lib/sessionExport/markdown.test.ts` | Closed test fixtures consume the expanded concrete-model session shape | Keeping fixtures beside their owners preserves exhaustive behavior checks without a parallel test registry | Session transcript/model metadata → render/export | Run Web suite after each upstream sync |

Every upstream sync must re-check for native launch-policy, persisted-field,
model-catalog, and composer extension APIs and remove any hook superseded by
an upstream seam.

## cc-switch and OpenUsage provider integration (2026-07-18)

Provider discovery, cc-switch handlers, and OpenUsage polling live in the
fork-owned `cli/src/modules/common/` modules. The following closed upstream
surfaces have no provider, RPC, session-metadata, or composer registration
API, so they retain the minimum typed hooks needed by that implementation.

| Files | Missing upstream seam | Why it cannot move out | Runtime path | Sync verification |
|---|---|---|---|---|
| `cli/src/api/apiMachine.ts`, `cli/src/modules/common/registerCommonHandlers.ts`, `cli/src/modules/common/rpcTypes.ts` | No external common-handler or machine-RPC registration API | Provider list/switch and usage queries must be installed in the existing machine RPC table with its closed request/result types | Web query/mutation → hub gateway → machine RPC → fork-owned cc-switch/OpenUsage handler | Read providers, switch provider, and observe usage through a live runner |
| `cli/src/runner/controlServer.ts`, `cli/src/runner/run.ts` | No runner lifecycle callback registry | Usage monitoring and provider state must start and stop with the owning runner process; a sibling module cannot observe that lifecycle without one explicit hook | Runner start → provider/usage monitor → session metadata updates → runner shutdown cleanup | Start a real runner, create a session, verify usage refresh, then stop it without a leaked monitor |
| `hub/src/sync/rpcGateway.ts`, `hub/src/sync/syncEngine.ts`, `hub/src/sync/sessionCache.ts`, `hub/src/sync/sessionModel.test.ts` | No external RPC gateway or session-derived-model registration surface | Provider changes and usage updates cross the hub's private machine gateway and cached session projection; parallel state would diverge from SSE/session reads | CLI RPC/update → sync engine/cache → SSE and REST session model | Switch a live session provider and verify the same provider/usage in REST, SSE, and refreshed Web UI |
| `hub/src/web/routes/machines.ts`, `hub/src/web/routes/machines.test.ts`, `hub/src/web/routes/sessions.ts`, `hub/src/web/routes/sessions.test.ts` | No route-extension registry for machine provider operations or session usage | Existing authenticated route factories own the machine/session resource checks and response contracts | Web provider/usage request → authenticated route → sync engine/RPC | Exercise successful reads/switches and a failed switch through the browser |
| `shared/src/apiTypes.ts` | No cross-package API contract extension registry | The provider, switch result, and usage payloads must remain one validated contract across CLI, hub, and Web | CLI domain result → shared API type → hub response → Web query | Typecheck plus live response inspection for every provider/usage variant |
| `web/src/components/SessionChat.tsx`, `web/src/lib/query-keys.ts`, `web/src/lib/sessionModelLabel.ts`, `web/src/lib/sessionModelLabel.test.ts` | No composer toolbar, query-key, or model-label provider registry | Session-scoped provider control and usage display occupy existing chat state/render slots; extracting their logic still requires these imports and typed props | Session chat → provider query/switch mutation → cache invalidation → model label and usage refresh | Switch provider in a real session and confirm the label and usage refresh without navigation |

Every upstream sync must re-check for native provider/usage registration,
runner lifecycle callbacks, and composer extension slots. When one exists,
remove the corresponding trunk patch and self-register the fork-owned module.

## OMP flavor (2026-07-18)

OMP launch, transport, configuration, model, permission, prompt, and display
logic live in `cli/src/omp/`; the command implementation lives in
`cli/src/commands/omp.ts`. Upstream exposes no flavor-provider registration
surface for the remaining closed registries.

| Files | Missing upstream seam | Why it cannot move out | Runtime path | Sync verification |
|---|---|---|---|---|
| `cli/src/commands/registry.ts`, `cli/src/commands/resume.ts` | No external command or resume-flavor registry | CLI parsing and resume dispatch use closed exhaustive tables; the fork-owned command still needs one typed entry in each | `hapi omp` or resume → command dispatcher → fork-owned OMP launcher | Start and resume an OMP session through the real runner |
| `shared/src/flavors.ts`, `shared/src/flavors.test.ts`, `shared/src/modes.ts` | No flavor/mode extension registry across package boundaries | OMP must remain a validated shared discriminant and permission-mode variant for CLI, hub, and Web; a sibling module cannot extend the closed union at runtime | Web spawn payload → shared validation → runner args → OMP mode mapping | Create OMP from Web and switch every exposed permission mode |
| `web/src/components/AssistantChat/modelOptions.ts` | No model-option provider registry keyed by flavor | The existing composer owns the closed model-option switch; extracting OMP values would still require the same switch hook | OMP session metadata → composer model menu → session config update | Change the OMP model in a live session and verify the next turn uses it |

Each upstream sync must re-check whether native flavor/command/model-provider
registration exists. If it does, remove these hooks and self-register the
fork-owned OMP module instead of preserving the trunk patch.

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

### Necessary-hook evidence

| Files | Missing upstream seam | Why it cannot move out | Runtime path | Sync verification |
|---|---|---|---|---|
| `hub/src/startHub.ts`, `hub/src/web/server.ts`, `hub/tsconfig.json` | No external hub bootstrap, route-mount, middleware, or extra-root registration API | The fork-owned store and adapters need one construction point and the HTTP stack must order authentication, resource authorization, and feature routes around upstream routes | Hub startup → gateway store/adapters → auth middleware → authorized core routes | Cold-start the dev hub, log in, and exercise admin plus resource routes |
| `hub/src/web/routes/cli.ts`, `hub/src/socket/server.ts`, `hub/src/socket/socketTypes.ts`, `hub/src/socket/handlers/terminal.ts` | CLI/socket factories expose no account-to-namespace or resource-namespace resolver registry | Cross-namespace identity must be resolved before upstream registration and terminal handlers consume the namespace; a sibling module cannot change those closed factory arguments | Gateway token → CLI/socket authentication → authorized namespace → runner or terminal operation | Register a real runner, deny an ungranted account, then grant operator access and spawn a session on the shared machine |
| `web/src/App.tsx`, `web/src/router.tsx`, `web/src/components/LoginPrompt.tsx` | No external app-shell, route, or login-component registration API | Login/admin screens need the existing app providers and protected-router slots; the compatibility re-export keeps upstream imports on one fork-owned implementation | App bootstrap → login gate → admin route → session UI | Use password login, visit the admin route, log out, then use an API token login |
| `web/src/api/client.ts`, `web/src/hooks/useAuth.ts`, `web/src/hooks/useAuthSource.ts`, `web/src/lib/app-context.tsx` | The upstream auth client/context has no credential-shape or authenticated-account extension registry | Gateway password/token requests and account identity must cross the existing client and React context as one typed state; parallel contexts would race refresh/logout | Login form → API client → JWT/account state → refresh/logout and authorized queries | Verify password and API-token login, refresh the page, and confirm account identity and logout remain coherent |
| `package.json`, `bun.lock` | Root fork modules have no package-local dependency injection seam | Hub-side fork modules are compiled from the workspace root and import Hono directly, so the root dependency graph must resolve the same runtime package | Workspace install → hub TypeScript/runtime resolution → gateway route mount | Run frozen install, typecheck, full tests, then cold-start the hub |

The adjacent `*.test.*` and locale files remain beside their upstream-owned
subjects because the web and hub test/i18n registries are file-local rather
than extensible. Re-run the same browser path after every upstream sync; a
clean compile alone does not prove route ordering or namespace authorization.

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
| 10 | `hub/src/web/server.ts` | Import `mountForkRoutes` + `buildForkDeps` from fork-features; mount routes after the existing `app.route('/api', …)` calls. Adapter receives per-request namespace from Hono ctx. | ~10 |
| 11 | `hub/tsconfig.json` | `rootDir` set to `..` and narrow include of the four hub-side fork-features files (excludes `cliHandler.ts`/`register.ts`/`providers/**` that pull cli `@/*` paths). | ~10 |
| 12 | `web/src/api/client.ts` | Add `forkSession(sessionId)` + `getFlavorCapabilities()` methods to `ApiClient`, slotted alongside `reopenSession`. | ~16 |
| 13 | `web/src/hooks/mutations/useSessionActions.ts` | Add `forkSession` field to the return-type interface + matching `useMutation` + `forkMutation.isPending` in the aggregate `isPending`. | ~17 |
| 14 | `web/src/components/SessionActionMenu.tsx` | Optional `onFork?` + `forkSupported?` props + `handleFork` + a Fork menu item rendered above Archive when both are truthy + new `ForkIcon`. | ~40 |
| 15 | `web/src/components/SessionHeader.tsx` | Wire `useFlavorCapabilities` + `forkSession` mutation; pass `onFork` + `forkSupported` to `SessionActionMenu`; expose `onSessionForked` callback prop; inline error dialog. | ~30 |
| 16 | `web/src/components/SessionList.tsx` | Same wiring inside `SessionItem`; `onFork` navigates via existing `onSelect` after fork; inline error dialog. | ~30 |
| 17 | `web/src/hooks/queries/useFlavorCapabilities.ts` | New file under upstream hooks dir. React Query hook fetching `/api/flavors/capabilities`. Originally added by session-fork; expanded by #57 c1 to a two-dim `FlavorForkCapability` shape (fork: none/head-only/at-message, files: none) plus `getFlavorForkCapability` accessor. Consumed by SessionList/SessionHeader/UserMessage to gate the Fork menu / message-level rewind button. | ~40 |
| 18 | `web/src/hooks/queries/useFlavorCapabilities.test.tsx` | Companion test file for (17). Kept alongside the hook because the web test convention nests `*.test.tsx` beside its subject. | ~50 |
| 19 | `web/src/components/AssistantChat/messages/UserMessage.tsx` | Add rewind button in the trailing action row that is capability-gated on `getFlavorForkCapability(...).fork === 'at-message'`, wire it through `useSessionActions.forkSession({forkPoint:{messageId}})`, stash source text via `setForkedFromText`, then navigate to `/sessions/$sessionId`. Placement in upstream file because the message bubble is upstream-owned and there is no per-role render register API — a fork-features side extraction would still need to hook this exact JSX slot. | ~35 |
| 20 | `web/src/hooks/useComposerDraft.ts` | Consume any one-shot fork-restore text (from #62 c5) before checking the draft; if hit, `clearDraft` + `setText` and skip the draft path. Fork-restore takes precedence because the new session id is brand-new and any draft under it is either empty or stale-from-a-prior-fork — the rewound source text is the intended prefill. Placement in upstream file because the timing constraint requires both branches to share the same rAF callback (two sibling hooks would race on committing `setText` before the composer marks itself dirty). | ~10 |

Total: 20 files, ~350 lines of trunk patch (the bulk in (14)/(15)/(16)/(19) which
are pure UI integration). Everything load-bearing is in
`fork-features/session-fork/`.

### Necessary-hook evidence

The numbered table records the stable integration surfaces. The following
groups record the five facts required by the fork placement rule for every
current session-fork delta, including later rewind plumbing and companion
tests that were missing from the older 20-file snapshot.

| Files | Missing upstream seam | Why it cannot move out | Runtime path | Sync verification |
|---|---|---|---|---|
| `cli/src/index.ts`, `cli/tsconfig.json` | No external flavor/provider bootstrap or extra-root registration API | Provider self-registration must execute before machine RPC handlers are installed; TypeScript must compile the imported root | CLI startup → provider registry → fork RPC | Start CLI, query `/api/flavors/capabilities`, confirm Claude and Codex capabilities |
| `cli/src/api/apiMachine.ts`, `shared/src/rpcMethods.ts`, `hub/src/sync/rpcGateway.ts`, `hub/src/sync/syncEngine.ts` | RPC registries expose no fork-owned method registration or typed public machine-call seam | The CLI handler and hub adapter need one entry at each private RPC boundary; widening the private generic gateway would expose more surface than the feature needs | Web fork request → hub controller → machine RPC → `handleForkSpawnSession` | Fork one live Claude and Codex session; confirm the request reaches the matching provider and returns a new HAPI session id |
| `shared/src/schemas.ts`, `shared/src/types.ts`, `hub/src/store/sessions.ts`, `hub/src/store/sessions.test.ts` | Metadata and stored-session schemas have no extension field registry | Fork lineage and deferred Claude launch must survive the shared schema and persisted session row; a sibling module cannot add fields to these closed product types | Fork controller persists lineage/deferred launch → session cache/store → resumed runner | Restart the dev hub between fork creation and deferred Claude launch; confirm lineage and launch recipe survive |
| `cli/src/claude/claudeRemote.ts`, `cli/src/claude/sdk/query.ts`, `cli/src/claude/sdk/types.ts`, `cli/src/claude/session.ts`, `cli/src/claude/types.ts`, `cli/src/claude/utils/sdkToLogConverter.ts`, `cli/src/runner/buildCliArgs.test.ts` and their adjacent `*.test.ts` files | Claude launcher/query exposes no external argument-parser or native-message-id rewind callback | `--resume-session-at` and the mutually-exclusive fork flags must pass through the existing launcher state and SDK query invocation; extracting them would duplicate the launcher parser/session state | Deferred launch recipe → runner args → Claude remote parser → SDK query → native Claude rewind | Rewind a live Claude session at the first and a later user message; verify the new session starts at the selected native message id |
| `cli/src/codex/appServerTypes.ts`, `cli/src/codex/codexAppServerClient.ts` | `sendRequest` is private and no custom request registration exists | A fork-owned provider cannot invoke native `thread/fork` without a narrow public typed client method | Codex provider → `forkThread` → app-server `thread/fork` → resume new thread | Rewind a live Codex session and verify the returned thread resumes with the expected turn count |
| `hub/src/web/server.ts`, `hub/tsconfig.json` | Hub route assembly has no external mount registry and its TypeScript program has a closed include root | The feature route must receive request namespace and sync-engine dependencies at server construction | `POST /api/sessions/:id/fork` and `GET /api/flavors/capabilities` → fork-owned Hono mount | Call both endpoints through the running dev hub as the authenticated browser user |
| `web/src/api/client.ts`, `web/src/hooks/mutations/useSessionActions.ts`, `web/src/components/SessionActionMenu.tsx`, `web/src/components/SessionHeader.tsx`, `web/src/components/SessionList.tsx`, `web/src/components/AssistantChat/messages/UserMessage.tsx`, `web/src/hooks/useComposerDraft.ts` and adjacent fork-specific tests | Upstream Web has no action-menu, per-message action, session-list action, or composer-restore registration seam | Each hook occupies an existing render/state timing slot; extracting the implementation still requires the same typed prop/import at that slot | Fork menu or rewind button → mutation → new session navigation → one-shot composer restore | Use the browser on live Claude/Codex sessions: head fork, message rewind, navigate to the new session, verify source text restoration and unchanged original session |

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

## Codex retry status (2026-07-17)

Codex remote-turn retry state is owned by the upstream launcher closure; it
does not expose a retry handler registration API. Moving the implementation
out would require exporting mutable turn state or duplicating the launcher
state machine, so the narrow fix remains in the upstream-owned files.

| File | Necessary patch |
|---|---|
| `cli/src/codex/codexRemoteLauncher.ts` | Roll back each failed turn before resubmitting the same user action, label retryable failures as attempt failures, and emit a final task failure if rollback cannot preserve single-action history. |
| `cli/src/codex/codexRemoteLauncher.test.ts` | Cover recovery after three failures, exhausted retries, rollback failure, and single-turn rollback calls. |

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
