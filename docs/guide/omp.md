# Oh My Pi

HAPI can run the Oh My Pi (`omp`) terminal interface locally and control the same native session remotely from the Web/PWA.

## Install

Install Oh My Pi on the runner machine, then verify that HAPI can find the executable:

```bash
omp --version
```

The initial HAPI integration targets OMP 17.0.4.

## Start a session

Start in the native terminal interface:

```bash
hapi omp
```

Resume an OMP-native session or select launch configuration explicitly:

```bash
hapi omp --resume <native-session-id>
hapi omp --model <provider/model> --effort high
```

Sessions created from a HAPI runner start in remote mode automatically. Terminal-created sessions start locally and can switch between local terminal control and remote Web control without creating a new HAPI session.

## Native remote protocol

Remote control starts OMP in native headless RPC mode (`omp --mode rpc`). The process exchanges typed JSONL commands, responses, and events with HAPI; OMP is not routed through ACP.

The native RPC path provides:

- text and image prompts, steer, follow-up, queued input cancellation, abort, and abort-and-prompt;
- provider-qualified model selection plus `off` / `auto` and model-supported thinking levels;
- native session resume, rename, clear, branch, local/remote handoff, and history continuity;
- tool, thinking, usage, retry, subagent, media, file, and extension UI events;
- host tools for `display_image`, `display_video`, and `send_file`;
- runner-scoped provider sign-in under **Settings → HAPI Extensions → Oh My Pi providers**, without copying credentials into chat.

## RPC event timeline allowlist

Choose which OMP events produce persisted chat messages, status rows, and cards
in HAPI. This is a CLI/runner-host setting, not an OMP-native setting or a Web
settings control. In `$HAPI_HOME/settings.json` (default `~/.hapi/settings.json`),
edit only `ompEventAllowlist`, preserving the other settings:

```json
{
  "ompEventAllowlist": ["message_end", "notice", "todo_reminder"]
}
```

An environment variable takes precedence over the file:

```bash
HAPI_OMP_EVENT_ALLOWLIST_JSON='["message_end","notice"]' hapi omp --hapi-starting-mode remote
```

Precedence is environment variable, then file field, then the defaults below.
Each configured array **completely replaces** the defaults; it is not merged.
Every event in the 43-name catalog below can be selected, including state-only
events that otherwise have no timeline projection. Selecting those events adds
an identifiable event record; existing message and card projections retain their
formats.

`[]` is valid and suppresses all RPC-event-derived timeline output, including
tool/subagent replay and host result presentation. It does not remove user input
records or historical messages, disable tool execution, interrupt session/config
or command-catalog synchronization, or suppress required interactive requests and
responses. Unknown future events remain diagnostic-only, not warning chat rows.

Configuration is read on the next remote launcher start: a new remote session or
re-entry into remote mode. Already-running sessions do not hot-reload it. Invalid
JSON, a non-object settings file, a non-array allowlist, non-string entries,
unknown names, duplicate names, and unreadable settings files fail explicitly
instead of silently restoring defaults. Missing files or an absent field use
defaults. A supplied environment variable replaces the file without reading it;
an empty environment string is invalid JSON, not an instruction to use defaults.

### Default selection

The complete low-noise default is:

```json
[
  "message_end",
  "tool_execution_start", "tool_execution_update", "tool_execution_end",
  "auto_compaction_start", "auto_compaction_end",
  "auto_retry_start", "auto_retry_end",
  "retry_fallback_applied", "retry_fallback_succeeded",
  "notice", "command_output", "extension_error", "rpc_frame_error",
  "subagent_lifecycle", "subagent_progress", "subagent_event",
  "host_tool_call", "host_uri_request"
]
```

Lifecycle, incremental assistant stream events, `tool_stream_update`, state/config
and advisor invalidations, cancellations, and other bookkeeping are off by
default. Add their exact names to your replacement array to expose them.

`extension_ui_request` is opt-in as one complete 11-method family. Its optional
widgets, status rows, and notifications are hidden by default. Required input
and permission controls still work when this event is excluded. Add
`extension_ui_request` to the replacement array to show its optional output;
individual methods are not separate selectors. Native `setTitle` is terminal
decoration and is always consumed without changing the conversation or its
metadata. Use the explicit `change_title` host tool to rename a HAPI session;
that side effect remains available even with an empty allowlist.

### Complete top-level catalog

Baseline: OMP **18.1.10**, cross-checked against both installed source unions and
stdout producers. Paths below are relative to the named `@oh-my-pi` package.
`RpcOutput` admits an open `object`, so its declaration alone is not an exhaustive
catalog.

| Source | Logical events |
| --- | --- |
| `pi-agent-core/src/types.ts`, `AgentEvent` (11); forwarded by `pi-coding-agent/src/modes/rpc/rpc-mode.ts` session subscription | `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_stream_update`, `tool_execution_end` |
| `pi-coding-agent/src/session/agent-session-events.ts`, session additions (17); same session subscription | `auto_compaction_start`, `auto_compaction_end`, `auto_retry_start`, `auto_retry_end`, `retry_fallback_applied`, `retry_fallback_succeeded`, `model_changed`, `config_warnings_changed`, `advisor_cost_changed`, `advisor_yielded`, `ttsr_triggered`, `todo_reminder`, `todo_auto_clear`, `irc_message`, `notice`, `thinking_level_changed`, `goal_updated` |
| `pi-coding-agent/src/modes/rpc/rpc-types.ts`, subagent envelopes (3); emitted through `rpc-subagents.ts` | `subagent_lifecycle`, `subagent_progress`, `subagent_event` |
| `pi-coding-agent/src/modes/rpc/rpc-types.ts`, extension/host requests (5) | `extension_ui_request`, `host_tool_call`, `host_tool_cancel`, `host_uri_request`, `host_uri_cancel` |
| `pi-coding-agent/src/modes/rpc/rpc-types.ts` and `rpc-mode.ts`, additional stdout producers (6) | `available_commands_update`, `prompt_result`, `command_output`, `session_info_update`, `config_update`, `extension_error` |
| `pi-coding-agent/src/modes/rpc/rpc-frame.ts`, framing error producer (1) | `rpc_frame_error` |

### Nested variants and control frames

Configuration always selects a **top-level** name. These nested variants are not
additional allowlist names, and there is no nested selector syntax:

- `message_update.assistantMessageEvent.type` owns 13 variants from
  `pi-ai/src/types.ts` (`AssistantMessageEvent`): `start`, `text_start`,
  `text_delta`, `text_end`, `thinking_start`, `thinking_delta`, `thinking_end`,
  `image_end`, `toolcall_start`, `toolcall_delta`, `toolcall_end`, `done`, `error`.
- `extension_ui_request.method` owns 11 methods from
  `pi-coding-agent/src/modes/rpc/rpc-types.ts`: `select`, `confirm`, `input`,
  `editor`, `cancel`, `notify`, `setStatus`, `setWidget`, `setTitle`,
  `set_editor_text`, `open_url`. Required bidirectional UI continues even when
  its optional timeline presentation is excluded.
- `subagent_event.payload.event.type` owns all 28 `AgentSessionEvent` variants:
  the 11 core events and 17 session additions in the first two catalog rows.
  This ownership comes from `pi-coding-agent/src/task/types.ts`; nested child
  output is selected by `subagent_event`, not by a second child-event allowlist.
  Snapshot lifecycle, snapshot progress, and transcript replay follow
  `subagent_lifecycle`, `subagent_progress`, and `subagent_event`, respectively.
  Selected progress or child traces may reconstruct their required card header
  even when lifecycle presentation is disabled.

`ready`, `response`, and `rpc_chunk` are transport/control frames, not selectable
logical events. `extension_ui_response`, `host_tool_update`, `host_tool_result`,
and `host_uri_result` travel **to** OMP and are likewise not output-event names.
The presentation policy never filters handshake, command responses, or framing.

## Permission labels

OMP 17.0.4 RPC does not expose a tool-permission or plan-mode protocol. HAPI therefore shows only `default` and `yolo` labels for OMP and starts both local and remote OMP processes with native Yolo execution. OMP tool calls do not create HAPI approval prompts.

Use OMP only in a workspace where direct tool execution is acceptable.

## Web controls

Provider sign-in is a runner setting, not a session action. Session chats never display sign-in controls. After a provider authenticates, the **New Session** model selector refreshes from OMP and lists that provider's qualified model IDs.

In a remote OMP session, the composer exposes the native model and thinking selectors plus the OMP permission label. The chat and session menus also provide queued-message cancellation, current-turn abort, per-message rewind/fork, archive/kill, media and file cards, subagent timelines, and local/remote switching.

The model and thinking values shown after reconnect come from the resumed native session. OMP 17.0.4 does not report quota utilization or reset timestamps, so HAPI shows native retry/fallback events instead of Claude-style usage-limit cards.

## Claude-only configuration

OMP 17.0.4 RPC has no equivalent mutation for these Claude configuration fields:

- fallback model selection before a turn;
- custom system prompt;
- appended system prompt;
- allowed/disallowed built-in tool filters.

HAPI identifies these fields as Claude-only instead of converting them into prompt text or host-tool registration.
