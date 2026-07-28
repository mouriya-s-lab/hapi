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
- provider login through the authenticated Web UI without copying credentials into chat.

## Permission labels

OMP 17.0.4 RPC does not expose a tool-permission or plan-mode protocol. HAPI therefore shows only `default` and `yolo` labels for OMP and starts both local and remote OMP processes with native Yolo execution. OMP tool calls do not create HAPI approval prompts.

Use OMP only in a workspace where direct tool execution is acceptable.

## Web controls

In a remote OMP session, the composer exposes the native model and thinking selectors plus the OMP permission label. The chat and session menus also provide queued-message cancellation, current-turn abort, per-message rewind/fork, archive/kill, media and file cards, subagent timelines, and local/remote switching.

The model and thinking values shown after reconnect come from the resumed native session. OMP 17.0.4 does not report quota utilization or reset timestamps, so HAPI shows native retry/fallback events instead of Claude-style usage-limit cards.

## Claude-only configuration

OMP 17.0.4 RPC has no equivalent mutation for these Claude configuration fields:

- fallback model selection before a turn;
- custom system prompt;
- appended system prompt;
- allowed/disallowed built-in tool filters.

HAPI identifies these fields as Claude-only instead of converting them into prompt text or host-tool registration.
