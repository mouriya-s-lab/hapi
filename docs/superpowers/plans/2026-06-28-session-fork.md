# Session Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-triggered session fork — web button → CLI runs provider native fork → hapi clones session DB row + messages → two independent sessions in sidebar.

**Architecture:** Self-contained `fork-features/session-fork/` module. CLI side has a per-flavor `ForkProvider` registry (Claude + Codex implementations). Hub side has `forkController` that orchestrates validate → machine RPC → DB transaction (insert new session row + clone messages + write `forkedFrom`/`forkedAt`). Single web entry (SessionActionMenu Fork item, capability-gated). 5 minimal trunk patches into upstream files.

**Tech Stack:** TypeScript, Hono (hub HTTP), Zod (schemas), bun test runner, React Query (web), better-sqlite3 (hub DB).

**Spec:** `docs/superpowers/specs/2026-06-28-session-fork-design.md`

---

## File Structure

**New files (fork-features/):**

```
fork-features/
├── trunk-patches.md
└── session-fork/
    ├── providerRegistry.ts
    ├── providerRegistry.test.ts
    ├── register.ts
    ├── providers/
    │   ├── claudeFork.ts
    │   ├── claudeFork.test.ts
    │   ├── codexFork.ts
    │   └── codexFork.test.ts
    ├── hubForkController.ts
    ├── hubForkController.test.ts
    ├── hubMount.ts
    ├── hubMount.test.ts
    └── rpcPayloads.ts            # ForkSpawnPayload / ForkSpawnResult zod schemas
```

**Upstream files modified (trunk patches, total 7):**

| File | Why |
|---|---|
| `shared/src/schemas.ts` | SessionMetadata + `forkedFrom?`, `forkedAt?` |
| `shared/src/rpcMethods.ts` | Add `ForkSpawnSession` |
| `cli/src/index.ts` | Side-effect import `fork-features/session-fork/register` |
| `cli/src/api/apiMachine.ts` | Register `RPC_METHODS.ForkSpawnSession` handler |
| `hub/src/web/server.ts` | `import { mountForkRoutes } …; mountForkRoutes(app, getSyncEngine)` |
| `web/src/hooks/mutations/useSessionActions.ts` | Expose `forkSession` mutation |
| `web/src/components/SessionActionMenu.tsx` | Add Fork menu item + capability gating |

---

### Task 1: Add fork metadata fields to SessionMetadata schema

**Files:**
- Modify: `shared/src/schemas.ts` (SessionMetadata zod schema, near line 36-62)
- Test: `shared/src/schemas.test.ts` (create if absent)

- [ ] **Step 1: Locate SessionMetadata schema**

Run: `rg -nC3 'SessionMetadata.*=.*z\.object|export.*SessionMetadata' shared/src/schemas.ts`

- [ ] **Step 2: Write failing test**

Create `shared/src/schemas.test.ts` if absent, else append:

```ts
import { describe, it, expect } from 'bun:test'
import { SessionMetadataSchema } from './schemas'

describe('SessionMetadata fork fields', () => {
  it('accepts forkedFrom and forkedAt', () => {
    const parsed = SessionMetadataSchema.parse({
      forkedFrom: 'src-session-id',
      forkedAt: 1719523200000,
    })
    expect(parsed.forkedFrom).toBe('src-session-id')
    expect(parsed.forkedAt).toBe(1719523200000)
  })
  it('still accepts metadata without fork fields', () => {
    expect(() => SessionMetadataSchema.parse({})).not.toThrow()
  })
})
```

- [ ] **Step 3: Run test, expect failure**

```
cd shared && bun test src/schemas.test.ts
```
Expected: FAIL — properties stripped or not present in parsed output.

- [ ] **Step 4: Add fields to SessionMetadataSchema**

Inside the `z.object({...})` block, add:
```ts
forkedFrom: z.string().optional(),
forkedAt: z.number().optional(),
```

- [ ] **Step 5: Run test, expect pass**

```
cd shared && bun test src/schemas.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/src/schemas.ts shared/src/schemas.test.ts
git commit -m "feat(shared): add forkedFrom/forkedAt to SessionMetadata

Trunk patch for session-fork feature.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 2: Add ForkSpawnSession to RPC_METHODS enum

**Files:**
- Modify: `shared/src/rpcMethods.ts`
- Test: `shared/src/rpcMethods.test.ts` (create if absent)

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'bun:test'
import { RPC_METHODS } from './rpcMethods'

describe('RPC_METHODS', () => {
  it('exposes ForkSpawnSession', () => {
    expect(RPC_METHODS.ForkSpawnSession).toBe('fork_spawn_session')
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```
cd shared && bun test src/rpcMethods.test.ts
```

- [ ] **Step 3: Add enum entry**

In `shared/src/rpcMethods.ts`, add (next to `SpawnHappySession`):

```ts
ForkSpawnSession: 'fork_spawn_session',
```

(Preserve existing comma style; this is a value of `RPC_METHODS` const.)

- [ ] **Step 4: Run test, expect pass**

```
cd shared && bun test src/rpcMethods.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add shared/src/rpcMethods.ts shared/src/rpcMethods.test.ts
git commit -m "feat(shared): add ForkSpawnSession RPC method

Trunk patch for session-fork feature.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 3: Define ForkSpawnPayload / ForkSpawnResult zod schemas

**Files:**
- Create: `fork-features/session-fork/rpcPayloads.ts`
- Test: `fork-features/session-fork/rpcPayloads.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'bun:test'
import { ForkSpawnPayloadSchema, ForkSpawnResultSchema } from './rpcPayloads'

describe('rpc payloads', () => {
  it('parses ForkSpawnPayload', () => {
    const payload = ForkSpawnPayloadSchema.parse({
      sourceMetadata: { claudeSessionId: 'abc' },
      sourceCwd: '/tmp/work',
      newHapiSessionId: 'new-id',
    })
    expect(payload.sourceCwd).toBe('/tmp/work')
  })
  it('parses ForkSpawnResult', () => {
    const result = ForkSpawnResultSchema.parse({
      providerSessionId: 'new-claude-id',
      metadataPatch: { claudeSessionId: 'new-claude-id' },
    })
    expect(result.providerSessionId).toBe('new-claude-id')
  })
  it('rejects ForkSpawnPayload without required fields', () => {
    expect(() => ForkSpawnPayloadSchema.parse({})).toThrow()
  })
})
```

- [ ] **Step 2: Run test, expect failure (file missing)**

```
bun test fork-features/session-fork/rpcPayloads.test.ts
```

- [ ] **Step 3: Implement schemas**

```ts
// fork-features/session-fork/rpcPayloads.ts
import { z } from 'zod'
import { SessionMetadataSchema } from '../../shared/src/schemas'

export const ForkSpawnPayloadSchema = z.object({
  sourceMetadata: SessionMetadataSchema,
  sourceCwd: z.string(),
  sourceModel: z.string().optional(),
  sourcePermissionMode: z.string().optional(),
  sourceCollaborationMode: z.string().optional(),
  newHapiSessionId: z.string(),
})
export type ForkSpawnPayload = z.infer<typeof ForkSpawnPayloadSchema>

export const ForkSpawnResultSchema = z.object({
  providerSessionId: z.string(),
  metadataPatch: SessionMetadataSchema.partial(),
})
export type ForkSpawnResult = z.infer<typeof ForkSpawnResultSchema>
```

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Commit**

```bash
git add fork-features/session-fork/rpcPayloads.ts fork-features/session-fork/rpcPayloads.test.ts
git commit -m "feat(fork): add ForkSpawn payload/result schemas

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 4: Implement provider registry

**Files:**
- Create: `fork-features/session-fork/providerRegistry.ts`
- Test: `fork-features/session-fork/providerRegistry.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach } from 'bun:test'
import {
  registerForkProvider,
  getForkProvider,
  listForkCapableFlavors,
  __resetRegistryForTests,
} from './providerRegistry'

const fakeProvider = {
  async spawnFork() {
    return { providerSessionId: 'x', metadataPatch: {} }
  },
}

beforeEach(() => __resetRegistryForTests())

describe('providerRegistry', () => {
  it('registers and retrieves a provider', () => {
    registerForkProvider('claude', fakeProvider)
    expect(getForkProvider('claude')).toBe(fakeProvider)
  })
  it('returns undefined for unregistered flavor', () => {
    expect(getForkProvider('cursor')).toBeUndefined()
  })
  it('listForkCapableFlavors returns registered flavors', () => {
    registerForkProvider('claude', fakeProvider)
    registerForkProvider('codex', fakeProvider)
    const list = listForkCapableFlavors().sort()
    expect(list).toEqual(['claude', 'codex'])
  })
})
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement registry**

```ts
// fork-features/session-fork/providerRegistry.ts
import type { ForkSpawnPayload, ForkSpawnResult } from './rpcPayloads'

export type Flavor = string  // mirror shared/src/schemas flavor strings

export interface ForkProvider {
  spawnFork(payload: ForkSpawnPayload): Promise<ForkSpawnResult>
}

const registry = new Map<Flavor, ForkProvider>()

export function registerForkProvider(flavor: Flavor, provider: ForkProvider): void {
  registry.set(flavor, provider)
}

export function getForkProvider(flavor: Flavor): ForkProvider | undefined {
  return registry.get(flavor)
}

export function listForkCapableFlavors(): Flavor[] {
  return [...registry.keys()]
}

export function __resetRegistryForTests(): void {
  registry.clear()
}
```

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Commit**

```bash
git add fork-features/session-fork/providerRegistry.ts fork-features/session-fork/providerRegistry.test.ts
git commit -m "feat(fork): add ForkProvider registry

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 5: Claude ForkProvider

**Files:**
- Create: `fork-features/session-fork/providers/claudeFork.ts`
- Test: `fork-features/session-fork/providers/claudeFork.test.ts`
- Reference: `cli/src/claude/claudeRemote.ts` (existing spawn pattern with `--resume` and `--fork-session`)

- [ ] **Step 1: Read existing Claude spawn pattern**

```
rg -nC5 '--resume|--fork-session|spawn.*claude' cli/src/claude/claudeRemote.ts
```
Identify: how the binary is spawned, how init message containing `sessionId` is parsed, how `claudeEnvVars` / `claudePath` are resolved.

- [ ] **Step 2: Write failing test**

```ts
import { describe, it, expect, mock } from 'bun:test'
import { claudeForkProvider, __setSpawnClaudeForkForTests } from './claudeFork'

describe('claudeForkProvider', () => {
  it('calls claude with --resume <src> --fork-session and returns new sessionId', async () => {
    const calls: any[] = []
    __setSpawnClaudeForkForTests(async (args) => {
      calls.push(args)
      return { newClaudeSessionId: 'new-claude-sess' }
    })
    const result = await claudeForkProvider.spawnFork({
      sourceMetadata: { claudeSessionId: 'src-sess' },
      sourceCwd: '/tmp/work',
      newHapiSessionId: 'new-hapi',
    } as any)
    expect(calls[0].sourceSessionId).toBe('src-sess')
    expect(calls[0].cwd).toBe('/tmp/work')
    expect(result.providerSessionId).toBe('new-claude-sess')
    expect(result.metadataPatch.claudeSessionId).toBe('new-claude-sess')
  })
  it('throws if sourceMetadata lacks claudeSessionId', async () => {
    await expect(
      claudeForkProvider.spawnFork({
        sourceMetadata: {},
        sourceCwd: '/tmp/x',
        newHapiSessionId: 'n',
      } as any)
    ).rejects.toThrow(/claudeSessionId/)
  })
})
```

- [ ] **Step 3: Run test, expect failure**

- [ ] **Step 4: Implement provider**

```ts
// fork-features/session-fork/providers/claudeFork.ts
import type { ForkProvider } from '../providerRegistry'
import type { ForkSpawnPayload, ForkSpawnResult } from '../rpcPayloads'

interface SpawnClaudeForkArgs {
  sourceSessionId: string
  cwd: string
  model?: string
  newHapiSessionId: string
}

interface SpawnClaudeForkResult {
  newClaudeSessionId: string
}

// Indirection allows test override.
let spawnClaudeForkImpl: (args: SpawnClaudeForkArgs) => Promise<SpawnClaudeForkResult> =
  async () => {
    throw new Error('spawnClaudeFork not wired; only valid in tests with override')
  }

export function __setSpawnClaudeForkForTests(
  impl: (args: SpawnClaudeForkArgs) => Promise<SpawnClaudeForkResult>
): void {
  spawnClaudeForkImpl = impl
}

// Production impl wired in Task 7 by importing from cli/src/claude module
// and calling its existing spawn primitive with --fork-session.
export function wireClaudeForkSpawn(
  impl: (args: SpawnClaudeForkArgs) => Promise<SpawnClaudeForkResult>
): void {
  spawnClaudeForkImpl = impl
}

export const claudeForkProvider: ForkProvider = {
  async spawnFork(payload: ForkSpawnPayload): Promise<ForkSpawnResult> {
    const sourceSessionId = payload.sourceMetadata.claudeSessionId
    if (!sourceSessionId) {
      throw new Error('claude fork: sourceMetadata.claudeSessionId is required')
    }
    const { newClaudeSessionId } = await spawnClaudeForkImpl({
      sourceSessionId,
      cwd: payload.sourceCwd,
      model: payload.sourceModel,
      newHapiSessionId: payload.newHapiSessionId,
    })
    return {
      providerSessionId: newClaudeSessionId,
      metadataPatch: { claudeSessionId: newClaudeSessionId },
    }
  },
}
```

- [ ] **Step 5: Run test, expect pass**

- [ ] **Step 6: Commit**

```bash
git add fork-features/session-fork/providers/claudeFork.ts fork-features/session-fork/providers/claudeFork.test.ts
git commit -m "feat(fork): add Claude ForkProvider with test-overridable spawn

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 6: Codex ForkProvider

**Files:**
- Create: `fork-features/session-fork/providers/codexFork.ts`
- Test: `fork-features/session-fork/providers/codexFork.test.ts`
- Reference: `cli/src/codex/codexAppServerClient.ts` (has `thread/start`, `thread/resume`; add `thread/fork` call here)

- [ ] **Step 1: Read existing Codex app-server methods**

```
rg -nC2 'thread/(start|resume|fork)' cli/src/codex/codexAppServerClient.ts cli/src/codex/appServerTypes.ts
```

- [ ] **Step 2: Write failing test**

```ts
import { describe, it, expect } from 'bun:test'
import { codexForkProvider, __setCodexClientForTests } from './codexFork'

describe('codexForkProvider', () => {
  it('calls thread/fork then thread/resume and returns new thread id', async () => {
    const calls: string[] = []
    __setCodexClientForTests({
      async forkThread({ threadId }) {
        calls.push(`fork:${threadId}`)
        return { newThreadId: 'forked-thread' }
      },
      async resumeThread({ threadId }) {
        calls.push(`resume:${threadId}`)
        return { ok: true }
      },
    })
    const result = await codexForkProvider.spawnFork({
      sourceMetadata: { codexSessionId: 'src-thread', codexThreadId: 'src-thread' },
      sourceCwd: '/tmp/work',
      newHapiSessionId: 'new-hapi',
    } as any)
    expect(calls).toEqual(['fork:src-thread', 'resume:forked-thread'])
    expect(result.providerSessionId).toBe('forked-thread')
    expect(result.metadataPatch.codexSessionId).toBe('forked-thread')
    expect(result.metadataPatch.codexThreadId).toBe('forked-thread')
  })
  it('throws when codexThreadId missing', async () => {
    __setCodexClientForTests({ async forkThread() { return { newThreadId: '' } }, async resumeThread() { return { ok: true } } })
    await expect(
      codexForkProvider.spawnFork({
        sourceMetadata: {},
        sourceCwd: '/tmp/x',
        newHapiSessionId: 'n',
      } as any)
    ).rejects.toThrow(/codexThreadId|codexSessionId/)
  })
})
```

- [ ] **Step 3: Run test, expect failure**

- [ ] **Step 4: Implement provider**

```ts
// fork-features/session-fork/providers/codexFork.ts
import type { ForkProvider } from '../providerRegistry'
import type { ForkSpawnPayload, ForkSpawnResult } from '../rpcPayloads'

interface CodexClient {
  forkThread(args: { threadId: string }): Promise<{ newThreadId: string }>
  resumeThread(args: { threadId: string }): Promise<unknown>
}

let codexClient: CodexClient | null = null

export function __setCodexClientForTests(client: CodexClient): void {
  codexClient = client
}

export function wireCodexClient(client: CodexClient): void {
  codexClient = client
}

export const codexForkProvider: ForkProvider = {
  async spawnFork(payload: ForkSpawnPayload): Promise<ForkSpawnResult> {
    if (!codexClient) throw new Error('codex fork: codexClient not wired')
    const src = payload.sourceMetadata.codexThreadId ?? payload.sourceMetadata.codexSessionId
    if (!src) {
      throw new Error('codex fork: sourceMetadata.codexThreadId/codexSessionId is required')
    }
    const { newThreadId } = await codexClient.forkThread({ threadId: src })
    await codexClient.resumeThread({ threadId: newThreadId })
    return {
      providerSessionId: newThreadId,
      metadataPatch: { codexSessionId: newThreadId, codexThreadId: newThreadId },
    }
  },
}
```

- [ ] **Step 5: Run test, expect pass**

- [ ] **Step 6: Commit**

```bash
git add fork-features/session-fork/providers/codexFork.ts fork-features/session-fork/providers/codexFork.test.ts
git commit -m "feat(fork): add Codex ForkProvider via thread/fork+thread/resume

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 7: Wire production spawn primitives (Claude binary + Codex client)

**Files:**
- Modify: `fork-features/session-fork/providers/claudeFork.ts` — add production wiring helper
- Modify: `fork-features/session-fork/providers/codexFork.ts` — same
- Create: `fork-features/session-fork/providers/claudeForkSpawn.ts` — wraps actual claude binary spawn
- Create: `fork-features/session-fork/providers/codexForkClient.ts` — wraps `CodexAppServerClient` with `forkThread`/`resumeThread`
- Reference: `cli/src/claude/claudeRemote.ts` for spawn; `cli/src/codex/codexAppServerClient.ts` for RPC

- [ ] **Step 1: For Claude, study how the launcher spawns claude bin**

```
rg -nC8 'spawn|child_process|execaCommand|Bun\.spawn' cli/src/claude/claudeRemote.ts cli/src/claude/sdk/query.ts cli/src/claude/sdk/utils.ts 2>/dev/null | head -100
```
Goal: identify the function that takes args + cwd and starts claude. The fork wrapper will call it with `['--resume', srcId, '--fork-session', '--print', '--output-format', 'stream-json', '--input-format', 'stream-json']` (mirror existing launch args minus interactive flags), parse the first `init` message for `sessionId`, then kill the child (we only need the fork id; lifecycle handover to actual launcher happens via hub re-spawn).

Decision: We **do not reuse** the long-running launcher for fork — too coupled. We spawn a one-shot child, read first init line, abort.

- [ ] **Step 2: Implement claudeForkSpawn.ts**

```ts
// fork-features/session-fork/providers/claudeForkSpawn.ts
import { spawn } from 'node:child_process'

export interface SpawnClaudeForkArgs {
  sourceSessionId: string
  cwd: string
  model?: string
  newHapiSessionId: string
  claudeBin?: string  // defaults to env HAPI_CLAUDE_PATH or 'claude'
}

export async function spawnClaudeFork(args: SpawnClaudeForkArgs): Promise<{ newClaudeSessionId: string }> {
  const bin = args.claudeBin ?? process.env.HAPI_CLAUDE_PATH ?? 'claude'
  const cliArgs = [
    '--resume', args.sourceSessionId,
    '--fork-session',
    '--print',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
  ]
  if (args.model) cliArgs.push('--model', args.model)

  return new Promise((resolve, reject) => {
    const child = spawn(bin, cliArgs, { cwd: args.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let buffer = ''
    let resolved = false
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        try { child.kill('SIGTERM') } catch {}
        reject(new Error('claude fork: timeout waiting for init message'))
      }
    }, 15_000)

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line)
          if (msg?.type === 'system' && msg?.subtype === 'init' && typeof msg?.session_id === 'string') {
            if (resolved) return
            resolved = true
            clearTimeout(timer)
            try { child.kill('SIGTERM') } catch {}
            resolve({ newClaudeSessionId: msg.session_id })
            return
          }
        } catch {
          // ignore non-json noise
        }
      }
    })
    child.on('error', (err) => {
      if (!resolved) { resolved = true; clearTimeout(timer); reject(err) }
    })
    child.on('exit', (code) => {
      if (!resolved) { resolved = true; clearTimeout(timer); reject(new Error(`claude fork exited code=${code} without init`)) }
    })
  })
}
```

- [ ] **Step 3: Write integration-style test for spawnClaudeFork (mock child_process)**

Skipped in unit phase — covered in E2E (Task 17). Add a TODO test that asserts the args building only:

```ts
// fork-features/session-fork/providers/claudeForkSpawn.test.ts
import { describe, it, expect } from 'bun:test'
// Pure args-building helper extracted for unit tests:
import { buildClaudeForkCliArgs } from './claudeForkSpawn'

describe('buildClaudeForkCliArgs', () => {
  it('includes --resume + --fork-session + stream-json flags', () => {
    const args = buildClaudeForkCliArgs({ sourceSessionId: 'src', cwd: '/t', newHapiSessionId: 'n' })
    expect(args).toContain('--resume')
    expect(args).toContain('src')
    expect(args).toContain('--fork-session')
    expect(args.includes('--print')).toBe(true)
  })
  it('appends --model when provided', () => {
    const args = buildClaudeForkCliArgs({ sourceSessionId: 's', cwd: '/t', newHapiSessionId: 'n', model: 'claude-opus-4-8' })
    expect(args).toContain('--model')
    expect(args).toContain('claude-opus-4-8')
  })
})
```

Refactor `claudeForkSpawn.ts` to extract `export function buildClaudeForkCliArgs(args): string[]` and use it inside `spawnClaudeFork`.

- [ ] **Step 4: Implement codexForkClient.ts**

```ts
// fork-features/session-fork/providers/codexForkClient.ts
import type { CodexAppServerClient } from '../../../cli/src/codex/codexAppServerClient'

export function createCodexForkClient(appServerClient: CodexAppServerClient) {
  return {
    async forkThread({ threadId }: { threadId: string }): Promise<{ newThreadId: string }> {
      // Calls JSON-RPC method 'thread/fork' on the app server.
      const resp = await (appServerClient as any).request('thread/fork', { threadId })
      const newId = (resp as any)?.threadId ?? (resp as any)?.newThreadId
      if (typeof newId !== 'string') throw new Error('codex thread/fork: missing threadId in response')
      return { newThreadId: newId }
    },
    async resumeThread({ threadId }: { threadId: string }): Promise<unknown> {
      return (appServerClient as any).request('thread/resume', { threadId })
    },
  }
}
```

Note: if `CodexAppServerClient` already exposes typed `forkThread` / `resumeThread` (check via `rg -n 'forkThread|resumeThread' cli/src/codex/codexAppServerClient.ts`), prefer those typed methods over the raw `request()` call.

- [ ] **Step 5: Run all provider tests**

```
bun test fork-features/session-fork/providers/
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add fork-features/session-fork/providers/
git commit -m "feat(fork): production wiring for claude and codex spawn primitives

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 8: register.ts wires providers + CLI entry import

**Files:**
- Create: `fork-features/session-fork/register.ts`
- Modify: `cli/src/index.ts` (trunk patch — add one import line at top)

- [ ] **Step 1: Write failing test**

```ts
// fork-features/session-fork/register.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import { __resetRegistryForTests, listForkCapableFlavors } from './providerRegistry'

beforeEach(() => __resetRegistryForTests())

describe('register.ts', () => {
  it('registers claude and codex providers on import', async () => {
    await import('./register')
    const flavors = listForkCapableFlavors().sort()
    expect(flavors).toEqual(['claude', 'codex'])
  })
})
```

- [ ] **Step 2: Run test, expect failure (register.ts missing)**

- [ ] **Step 3: Implement register.ts**

```ts
// fork-features/session-fork/register.ts
import { registerForkProvider } from './providerRegistry'
import { claudeForkProvider, wireClaudeForkSpawn } from './providers/claudeFork'
import { codexForkProvider } from './providers/codexFork'
import { spawnClaudeFork } from './providers/claudeForkSpawn'

wireClaudeForkSpawn(spawnClaudeFork)
registerForkProvider('claude', claudeForkProvider)
registerForkProvider('codex', codexForkProvider)
// codex client wiring happens at app-server connect time (Task 9).
```

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Add CLI entry side-effect import**

In `cli/src/index.ts`, add at top of file (after the shebang if any, before first other import):

```ts
import '../../fork-features/session-fork/register'
```

Adjust relative path to whatever resolves from `cli/src/index.ts` to `fork-features/session-fork/register`. Verify with: `node -e "console.log(require.resolve('../../fork-features/session-fork/register'))"` run from `cli/src/`.

- [ ] **Step 6: Commit**

```bash
git add fork-features/session-fork/register.ts fork-features/session-fork/register.test.ts cli/src/index.ts
git commit -m "feat(fork): register Claude+Codex ForkProviders on cli startup

Trunk patch: cli/src/index.ts side-effect import.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 9: CLI RPC handler for ForkSpawnSession

**Files:**
- Modify: `cli/src/api/apiMachine.ts` (register handler)
- Test: extend `cli/src/api/apiMachine.test.ts` if present, else inline test

- [ ] **Step 1: Read existing RPC handler pattern**

```
rg -nC6 'SpawnHappySession' cli/src/api/apiMachine.ts
```
Identify: how a handler is registered (a `.handle(RPC_METHODS.X, async (params) => ...)` style call or similar).

- [ ] **Step 2: Write failing test**

```ts
// fork-features/session-fork/cliHandler.test.ts
import { describe, it, expect, mock } from 'bun:test'
import { handleForkSpawnSession } from './cliHandler'
import { __resetRegistryForTests, registerForkProvider } from './providerRegistry'

describe('handleForkSpawnSession', () => {
  it('dispatches to provider for the source flavor and returns its result', async () => {
    __resetRegistryForTests()
    let called: any = null
    registerForkProvider('claude', {
      async spawnFork(p) {
        called = p
        return { providerSessionId: 'new', metadataPatch: { claudeSessionId: 'new' } }
      },
    })
    const result = await handleForkSpawnSession({
      flavor: 'claude',
      payload: {
        sourceMetadata: { claudeSessionId: 'src' },
        sourceCwd: '/tmp',
        newHapiSessionId: 'h',
      },
    } as any)
    expect(called.newHapiSessionId).toBe('h')
    expect(result.providerSessionId).toBe('new')
  })
  it('throws if flavor not registered', async () => {
    __resetRegistryForTests()
    await expect(
      handleForkSpawnSession({ flavor: 'cursor', payload: {} } as any)
    ).rejects.toThrow(/no fork provider/)
  })
})
```

- [ ] **Step 3: Run test, expect failure**

- [ ] **Step 4: Implement handler**

```ts
// fork-features/session-fork/cliHandler.ts
import { getForkProvider } from './providerRegistry'
import { ForkSpawnPayloadSchema, type ForkSpawnResult } from './rpcPayloads'

export interface ForkSpawnRpcRequest {
  flavor: string
  payload: unknown  // ForkSpawnPayload pre-parse
}

export async function handleForkSpawnSession(req: ForkSpawnRpcRequest): Promise<ForkSpawnResult> {
  const provider = getForkProvider(req.flavor)
  if (!provider) throw new Error(`no fork provider for flavor ${req.flavor}`)
  const payload = ForkSpawnPayloadSchema.parse(req.payload)
  return provider.spawnFork(payload)
}
```

- [ ] **Step 5: Register handler in apiMachine.ts**

In `cli/src/api/apiMachine.ts`, locate the SpawnHappySession handler registration, then immediately below add:

```ts
import { handleForkSpawnSession } from '../../../fork-features/session-fork/cliHandler'
// ... wherever handlers register:
machineApi.handle(RPC_METHODS.ForkSpawnSession, async (params: unknown) => {
  return handleForkSpawnSession(params as any)
})
```

Adjust syntax to match the actual handler registration style observed in Step 1.

- [ ] **Step 6: Run tests**

```
bun test fork-features/session-fork/cliHandler.test.ts
cd cli && bun test src/api/apiMachine.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add fork-features/session-fork/cliHandler.ts fork-features/session-fork/cliHandler.test.ts cli/src/api/apiMachine.ts
git commit -m "feat(fork): cli RPC handler for ForkSpawnSession

Trunk patch: cli/src/api/apiMachine.ts registers ForkSpawnSession handler.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 10: Hub forkController (validate + RPC + DB transaction)

**Files:**
- Create: `fork-features/session-fork/hubForkController.ts`
- Create: `fork-features/session-fork/hubForkController.test.ts`
- Reference: `hub/src/store/sessions.ts` (`getSession`, `getOrCreateSession`, `updateSessionMetadata`); `hub/src/store/messages.ts:100` (`copyMessageToSession`); `hub/src/sync/syncEngine.ts:751` (`spawnSession`); `hub/src/sync/rpcGateway.ts:130` (`machineRpc`)

- [ ] **Step 1: Write failing test (with mocked deps)**

```ts
import { describe, it, expect } from 'bun:test'
import { forkSession } from './hubForkController'

const mkDeps = (overrides: any = {}) => ({
  getSession: () => ({
    id: 'src',
    machineId: 'mac-1',
    metadata: { flavor: 'claude', claudeSessionId: 'csrc', title: 'Hello' },
    cwd: '/work',
    model: 'claude-opus-4-8',
    permissionMode: 'default',
    collaborationMode: 'default',
    activeTurn: false,
    ...overrides.session,
  }),
  hasActiveTurn: () => overrides.activeTurn ?? false,
  generateSessionId: () => 'new-hapi',
  machineRpc: async (_machineId: string, _method: string, _payload: any) => {
    if (overrides.machineRpc) return overrides.machineRpc(_machineId, _method, _payload)
    return { providerSessionId: 'cnew', metadataPatch: { claudeSessionId: 'cnew' } }
  },
  insertSession: (row: any) => { overrides.captured?.push(['insert', row]) },
  copyMessages: (src: string, dst: string) => { overrides.captured?.push(['copy', src, dst]); return { copied: 3 } },
  killLauncher: async (_machineId: string, _providerSessionId: string) => { overrides.captured?.push(['kill']) },
  tx: async (fn: () => void | Promise<void>) => { await fn() },
})

describe('forkSession', () => {
  it('happy path: validates, rpcs, inserts session row, clones messages', async () => {
    const captured: any[] = []
    const deps = mkDeps({ captured })
    const res = await forkSession({ srcSessionId: 'src', deps })
    expect(res.newSessionId).toBe('new-hapi')
    expect(captured.find(c => c[0] === 'insert')[1].metadata.forkedFrom).toBe('src')
    expect(captured.find(c => c[0] === 'insert')[1].metadata.claudeSessionId).toBe('cnew')
    expect(captured.find(c => c[0] === 'copy')).toEqual(['copy', 'src', 'new-hapi'])
  })
  it('returns 404 when source missing', async () => {
    const deps = { ...mkDeps(), getSession: () => null } as any
    await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toMatchObject({ status: 404 })
  })
  it('returns 400 when flavor not supported', async () => {
    const deps = mkDeps({ session: { metadata: { flavor: 'cursor' } } })
    await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toMatchObject({ status: 400 })
  })
  it('returns 409 when active turn', async () => {
    const deps = mkDeps({ activeTurn: true })
    await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toMatchObject({ status: 409 })
  })
  it('rolls back and kills launcher when DB clone fails', async () => {
    const captured: any[] = []
    const deps = {
      ...mkDeps({ captured }),
      copyMessages: () => { throw new Error('boom') },
    } as any
    await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toThrow()
    expect(captured.find(c => c[0] === 'kill')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement forkController**

```ts
// fork-features/session-fork/hubForkController.ts
import { listForkCapableFlavors } from './providerRegistry'
import type { ForkSpawnResult } from './rpcPayloads'

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export interface StoredSessionLike {
  id: string
  machineId: string
  metadata: Record<string, any>
  cwd: string
  model?: string
  permissionMode?: string
  collaborationMode?: string
}

export interface ForkDeps {
  getSession(id: string): StoredSessionLike | null
  hasActiveTurn(id: string): boolean
  generateSessionId(): string
  machineRpc(machineId: string, method: string, payload: unknown): Promise<ForkSpawnResult>
  insertSession(row: { id: string; machineId: string; metadata: Record<string, any>; cwd: string; model?: string; permissionMode?: string; collaborationMode?: string }): void
  copyMessages(srcSessionId: string, dstSessionId: string): { copied: number }
  killLauncher(machineId: string, providerSessionId: string): Promise<void>
  tx<T>(fn: () => T | Promise<T>): Promise<T>
}

export async function forkSession(args: { srcSessionId: string; deps: ForkDeps }): Promise<{ newSessionId: string }> {
  const { srcSessionId, deps } = args
  const src = deps.getSession(srcSessionId)
  if (!src) throw new HttpError(404, `session ${srcSessionId} not found`)
  const flavor = src.metadata.flavor
  if (!flavor || !listForkCapableFlavors().includes(flavor)) {
    throw new HttpError(400, `flavor ${flavor ?? '<none>'} does not support fork`)
  }
  if (deps.hasActiveTurn(srcSessionId)) {
    throw new HttpError(409, 'source session has an active turn; wait for it to complete')
  }
  const newSessionId = deps.generateSessionId()
  const rpcResult = await deps.machineRpc(src.machineId, 'fork_spawn_session', {
    flavor,
    payload: {
      sourceMetadata: src.metadata,
      sourceCwd: src.cwd,
      sourceModel: src.model,
      sourcePermissionMode: src.permissionMode,
      sourceCollaborationMode: src.collaborationMode,
      newHapiSessionId: newSessionId,
    },
  })
  try {
    await deps.tx(async () => {
      const newMetadata: Record<string, any> = {
        ...src.metadata,
        ...rpcResult.metadataPatch,
        forkedFrom: srcSessionId,
        forkedAt: Date.now(),
        title: `${src.metadata.title ?? 'Untitled'} (fork)`,
      }
      deps.insertSession({
        id: newSessionId,
        machineId: src.machineId,
        metadata: newMetadata,
        cwd: src.cwd,
        model: src.model,
        permissionMode: src.permissionMode,
        collaborationMode: src.collaborationMode,
      })
      deps.copyMessages(srcSessionId, newSessionId)
    })
    return { newSessionId }
  } catch (err) {
    // Best-effort: kill the launcher we just started on the runner side
    deps.killLauncher(src.machineId, rpcResult.providerSessionId).catch(() => undefined)
    throw err
  }
}
```

- [ ] **Step 4: Run test, expect pass**

```
bun test fork-features/session-fork/hubForkController.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add fork-features/session-fork/hubForkController.ts fork-features/session-fork/hubForkController.test.ts
git commit -m "feat(fork): hub forkController with validate/RPC/tx + error paths

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 11: Hub mount routes (POST /api/sessions/:id/fork + GET /api/flavors/capabilities)

**Files:**
- Create: `fork-features/session-fork/hubMount.ts`
- Create: `fork-features/session-fork/hubMount.test.ts`
- Reference: `hub/src/web/routes/codexDesktop.ts` for Hono route style; `hub/src/web/routes/guards.ts` for `requireSyncEngine`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'bun:test'
import { Hono } from 'hono'
import { mountForkRoutes } from './hubMount'
import { __resetRegistryForTests, registerForkProvider } from './providerRegistry'

describe('mountForkRoutes', () => {
  it('GET /api/flavors/capabilities returns fork list', async () => {
    __resetRegistryForTests()
    registerForkProvider('claude', { async spawnFork() { return { providerSessionId: 'x', metadataPatch: {} } } })
    const app = new Hono()
    mountForkRoutes(app, () => fakeSyncEngine())
    const res = await app.request('/api/flavors/capabilities')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fork).toContain('claude')
  })
  it('POST /api/sessions/:id/fork returns newSessionId on success', async () => {
    __resetRegistryForTests()
    registerForkProvider('claude', { async spawnFork() { return { providerSessionId: 'cnew', metadataPatch: { claudeSessionId: 'cnew' } } } })
    const app = new Hono()
    mountForkRoutes(app, () => fakeSyncEngine())
    const res = await app.request('/api/sessions/src/fork', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.newSessionId).toBe('string')
  })
  it('returns 409 when active turn', async () => {
    __resetRegistryForTests()
    registerForkProvider('claude', { async spawnFork() { return { providerSessionId: 'x', metadataPatch: {} } } })
    const app = new Hono()
    mountForkRoutes(app, () => fakeSyncEngine({ activeTurn: true }))
    const res = await app.request('/api/sessions/src/fork', { method: 'POST' })
    expect(res.status).toBe(409)
  })
})

function fakeSyncEngine(opts: { activeTurn?: boolean } = {}) {
  return {
    getSession: () => ({ id: 'src', machineId: 'm', metadata: { flavor: 'claude', claudeSessionId: 'c' }, cwd: '/w' }),
    hasActiveTurn: () => !!opts.activeTurn,
    generateSessionId: () => 'new',
    machineRpc: async () => ({ providerSessionId: 'cnew', metadataPatch: { claudeSessionId: 'cnew' } }),
    insertSession: () => {},
    copyMessages: () => ({ copied: 0 }),
    killLauncher: async () => {},
    tx: async (fn: any) => { await fn() },
  } as any
}
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement hubMount.ts**

```ts
// fork-features/session-fork/hubMount.ts
import type { Hono } from 'hono'
import { forkSession, HttpError, type ForkDeps } from './hubForkController'
import { listForkCapableFlavors } from './providerRegistry'

export type ForkSyncEngineLike = ForkDeps

export function mountForkRoutes(app: Hono, getSyncEngine: () => ForkSyncEngineLike | null): void {
  app.get('/api/flavors/capabilities', (c) => {
    return c.json({ fork: listForkCapableFlavors() })
  })
  app.post('/api/sessions/:id/fork', async (c) => {
    const engine = getSyncEngine()
    if (!engine) return c.json({ error: 'sync engine unavailable' }, 503)
    const srcSessionId = c.req.param('id')
    try {
      const result = await forkSession({ srcSessionId, deps: engine })
      return c.json(result)
    } catch (err) {
      if (err instanceof HttpError) return c.json({ error: err.message }, err.status as any)
      const message = err instanceof Error ? err.message : 'fork failed'
      return c.json({ error: message }, 500)
    }
  })
}
```

- [ ] **Step 4: Run test, expect pass**

```
bun test fork-features/session-fork/hubMount.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add fork-features/session-fork/hubMount.ts fork-features/session-fork/hubMount.test.ts
git commit -m "feat(fork): hub Hono routes for fork + capability query

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 12: Wire forkDeps adapter from hub SyncEngine

**Files:**
- Create: `fork-features/session-fork/hubSyncEngineAdapter.ts` — translates `SyncEngine` + stores into `ForkDeps`
- Test: `fork-features/session-fork/hubSyncEngineAdapter.test.ts`
- Reference: `hub/src/sync/syncEngine.ts:751` (spawnSession), `hub/src/store/sessions.ts:184` (getOrCreateSession), `hub/src/store/messages.ts:100` (copyMessageToSession), `hub/src/sync/rpcGateway.ts:130` (machineRpc)

- [ ] **Step 1: Read SyncEngine surface**

```
rg -nC2 'machineRpc|getSession|hasActiveTurn|class SyncEngine' hub/src/sync/syncEngine.ts | head -50
rg -nC2 'export.*messages' hub/src/store/messages.ts | head -20
```

- [ ] **Step 2: Write failing test (light — adapter is mostly translation)**

```ts
import { describe, it, expect } from 'bun:test'
import { buildForkDeps } from './hubSyncEngineAdapter'

describe('buildForkDeps', () => {
  it('translates SyncEngine surface into ForkDeps shape', () => {
    const fakeEngine: any = {
      store: {
        sessions: {
          getSession: (_db: any, id: string) => id === 'src' ? { id: 'src', metadata: { flavor: 'claude' }, machineId: 'm', cwd: '/w' } : null,
          insertSession: () => {},
        },
        messages: {
          copyMessageToSession: () => ({ id: 'mid' }),
          getMessages: () => [{ id: 'a' }, { id: 'b' }],
        },
      },
      db: { transaction: (fn: any) => fn },
      hasActiveTurn: () => false,
      machineRpc: async () => ({ providerSessionId: 'x', metadataPatch: {} }),
    }
    const deps = buildForkDeps(fakeEngine)
    expect(deps.getSession('src')?.metadata.flavor).toBe('claude')
    expect(deps.copyMessages('src', 'dst').copied).toBe(2)
  })
})
```

- [ ] **Step 3: Implement adapter**

```ts
// fork-features/session-fork/hubSyncEngineAdapter.ts
import { randomUUID } from 'node:crypto'
import type { ForkDeps, ForkSyncEngineLike } from './hubMount'

export function buildForkDeps(syncEngine: any): ForkDeps {
  return {
    getSession(id) {
      const row = syncEngine.store.sessions.getSession(syncEngine.db, id)
      if (!row) return null
      return {
        id: row.id,
        machineId: row.machineId,
        metadata: row.metadata ?? {},
        cwd: row.cwd ?? row.metadata?.cwd ?? '',
        model: row.model,
        permissionMode: row.permissionMode,
        collaborationMode: row.collaborationMode,
      }
    },
    hasActiveTurn(id) {
      return typeof syncEngine.hasActiveTurn === 'function' ? !!syncEngine.hasActiveTurn(id) : false
    },
    generateSessionId() {
      return randomUUID()
    },
    async machineRpc(machineId, method, payload) {
      const res = await syncEngine.machineRpc(machineId, method, payload)
      return res
    },
    insertSession(row) {
      syncEngine.store.sessions.insertSession(syncEngine.db, row)
    },
    copyMessages(srcId, dstId) {
      const msgs = syncEngine.store.messages.getMessages(syncEngine.db, srcId)
      for (const m of msgs) {
        syncEngine.store.messages.copyMessageToSession(syncEngine.db, dstId, {
          content: m.content,
          createdAt: m.createdAt,
          invokedAt: m.invokedAt,
          localId: undefined,
          scheduledAt: m.scheduledAt ?? null,
        })
      }
      return { copied: msgs.length }
    },
    async killLauncher(machineId, providerSessionId) {
      try {
        await syncEngine.machineRpc(machineId, 'kill_provider_session', { providerSessionId })
      } catch {
        // best-effort
      }
    },
    async tx(fn) {
      const runner = syncEngine.db.transaction(() => fn())
      return runner()
    },
  }
}
```

If `syncEngine.store.sessions` lacks `insertSession` (current store exposes `getOrCreateSession`), the adapter must instead use `getOrCreateSession` with the new id (verify with `rg -n 'export function (insertSession|getOrCreateSession|createSession)' hub/src/store/sessions.ts`). Adjust the call accordingly — keep adapter as the single place that knows hub store quirks.

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git add fork-features/session-fork/hubSyncEngineAdapter.ts fork-features/session-fork/hubSyncEngineAdapter.test.ts
git commit -m "feat(fork): hub SyncEngine→ForkDeps adapter

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 13: Trunk patch hub/src/web/server.ts to mount fork routes

**Files:**
- Modify: `hub/src/web/server.ts`

- [ ] **Step 1: Read current mount block (around line 230-249)**

```
rg -nC2 'app\.route|mountForkRoutes' hub/src/web/server.ts
```

- [ ] **Step 2: Add import near top with other route imports**

In `hub/src/web/server.ts` near line 17-18, add:

```ts
import { mountForkRoutes } from '../../../fork-features/session-fork/hubMount'
import { buildForkDeps } from '../../../fork-features/session-fork/hubSyncEngineAdapter'
```

(Adjust relative path: `hub/src/web/server.ts` → `fork-features/session-fork/...` is `../../../fork-features/...`.)

- [ ] **Step 3: Mount routes after line 249**

After the last existing `app.route('/api', ...)` call, add:

```ts
mountForkRoutes(app, () => {
  const engine = options.getSyncEngine()
  return engine ? buildForkDeps(engine) : null
})
```

- [ ] **Step 4: Smoke test: start hub and hit endpoint**

```
cd hub && bun run dev &
sleep 2
curl -s http://localhost:<hub-port>/api/flavors/capabilities
kill %1
```
Expected: JSON `{"fork":["claude","codex"]}` (hub port from existing config — see `hub/src/web/server.ts` listener).

- [ ] **Step 5: Commit**

```bash
git add hub/src/web/server.ts
git commit -m "feat(hub): mount fork routes via fork-features module

Trunk patch: import + mount in server.ts. Capability endpoint and POST /api/sessions/:id/fork both live in fork-features/session-fork/hubMount.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 14: Web — useFlavorCapabilities hook

**Files:**
- Create: `web/src/hooks/useFlavorCapabilities.ts`
- Test: `web/src/hooks/useFlavorCapabilities.test.ts`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, mock } from 'bun:test'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useFlavorCapabilities } from './useFlavorCapabilities'

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useFlavorCapabilities', () => {
  it('returns the fork capability list', async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ fork: ['claude', 'codex'] }))) as any
    const { result } = renderHook(() => useFlavorCapabilities(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeTruthy())
    expect(result.current.data?.fork).toEqual(['claude', 'codex'])
  })
})
```

- [ ] **Step 2: Implement hook**

```ts
// web/src/hooks/useFlavorCapabilities.ts
import { useQuery } from '@tanstack/react-query'

export interface FlavorCapabilities {
  fork: string[]
}

export function useFlavorCapabilities() {
  return useQuery<FlavorCapabilities>({
    queryKey: ['flavor-capabilities'],
    queryFn: async () => {
      const res = await fetch('/api/flavors/capabilities')
      if (!res.ok) throw new Error(`flavor capabilities ${res.status}`)
      return res.json()
    },
    staleTime: 10 * 60 * 1000, // 10 min
  })
}
```

- [ ] **Step 3: Run test, expect pass**

```
cd web && bunx vitest run src/hooks/useFlavorCapabilities.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/useFlavorCapabilities.ts web/src/hooks/useFlavorCapabilities.test.ts
git commit -m "feat(web): useFlavorCapabilities hook (10-min cached)

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 15: Web — forkSession mutation in useSessionActions

**Files:**
- Modify: `web/src/hooks/mutations/useSessionActions.ts`
- Test: `web/src/hooks/mutations/useSessionActions.test.ts` (extend if exists)

- [ ] **Step 1: Read current useSessionActions shape**

```
rg -nC3 'useSessionActions|archiveSession|reopenSession' web/src/hooks/mutations/useSessionActions.ts | head -40
```
Note the mutation pattern (probably `useMutation` from React Query + a hub fetch helper).

- [ ] **Step 2: Write failing test**

```ts
import { describe, it, expect, mock } from 'bun:test'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'
import { useSessionActions } from './useSessionActions'

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('useSessionActions.forkSession', () => {
  it('POSTs to /api/sessions/:id/fork and returns newSessionId', async () => {
    globalThis.fetch = mock(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url
      if (url.endsWith('/fork')) return new Response(JSON.stringify({ newSessionId: 'new-id' }))
      return new Response('{}')
    }) as any
    const { result } = renderHook(() => useSessionActions(/* …deps… */ {} as any), { wrapper })
    let res: any
    await act(async () => { res = await result.current.forkSession('src-id') })
    expect(res.newSessionId).toBe('new-id')
  })
})
```

(Adapt `useSessionActions(/* …deps… */)` to its actual signature observed in Step 1.)

- [ ] **Step 3: Add forkSession to useSessionActions**

```ts
// In web/src/hooks/mutations/useSessionActions.ts, add inside the hook return object:
forkSession: async (sourceSessionId: string): Promise<{ newSessionId: string }> => {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sourceSessionId)}/fork`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw Object.assign(new Error(body.error ?? `fork failed (${res.status})`), { status: res.status })
  }
  return res.json()
},
```

Also expose the type in the hook's return signature (mirror archiveSession's shape).

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/mutations/useSessionActions.ts web/src/hooks/mutations/useSessionActions.test.ts
git commit -m "feat(web): forkSession action in useSessionActions

Trunk patch.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 16: Web — Fork menu item in SessionActionMenu (capability-gated)

**Files:**
- Modify: `web/src/components/SessionActionMenu.tsx`
- Test: `web/src/components/SessionActionMenu.test.tsx` (extend)
- Modify: callers of `SessionActionMenu` to pass `onFork` (find with grep)

- [ ] **Step 1: Read current SessionActionMenu props + layout**

Already known: props include `onRename`, `onArchive`, `onReopen?`. Menu items rendered around lines 165-200.

```
rg -nC5 'onReopen\?' web/src/components/SessionActionMenu.tsx
```

- [ ] **Step 2: Write failing test**

```tsx
import { describe, it, expect, mock } from 'bun:test'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionActionMenu } from './SessionActionMenu'

describe('SessionActionMenu Fork item', () => {
  it('shows Fork when onFork provided and forkSupported is true', () => {
    render(<SessionActionMenu
      onRename={() => {}}
      onArchive={() => {}}
      onFork={() => {}}
      forkSupported={true}
      // …other required props with no-ops
    />)
    expect(screen.queryByText(/Fork session/i)).toBeInTheDocument()
  })
  it('hides Fork when forkSupported is false', () => {
    render(<SessionActionMenu
      onRename={() => {}}
      onArchive={() => {}}
      onFork={() => {}}
      forkSupported={false}
    />)
    expect(screen.queryByText(/Fork session/i)).not.toBeInTheDocument()
  })
  it('calls onFork when item clicked', () => {
    const onFork = mock(() => {})
    render(<SessionActionMenu
      onRename={() => {}}
      onArchive={() => {}}
      onFork={onFork}
      forkSupported={true}
    />)
    fireEvent.click(screen.getByText(/Fork session/i))
    expect(onFork).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Add prop + menu item**

In `web/src/components/SessionActionMenu.tsx`:

1. Extend props type:
```ts
onFork?: () => void
forkSupported?: boolean
```

2. In the menu render block (above `onArchive` item), add:
```tsx
{props.onFork && props.forkSupported && (
  <DropdownMenuItem onSelect={() => props.onFork?.()}>
    Fork session
  </DropdownMenuItem>
)}
```
(Use the same component used by Archive/Reopen items — check Step 1 grep for the exact JSX tag.)

- [ ] **Step 4: Update SessionActionMenu callers to wire onFork**

```
rg -nl 'SessionActionMenu' web/src
```
For each consumer, import `useSessionActions().forkSession` and `useFlavorCapabilities()`, then pass:
```tsx
onFork={async () => {
  try {
    const { newSessionId } = await forkSession(session.id)
    navigate(`/sessions/${newSessionId}`)
  } catch (err: any) {
    toast.error(err.message ?? 'Fork failed')
  }
}}
forkSupported={capabilities?.fork?.includes(session.metadata.flavor) ?? false}
```
(Use the codebase's existing toast helper and navigate hook — mirror archiveSession consumer style.)

- [ ] **Step 5: Run test, expect pass**

```
cd web && bunx vitest run src/components/SessionActionMenu.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add web/src/components/SessionActionMenu.tsx web/src/components/SessionActionMenu.test.tsx <consumer files>
git commit -m "feat(web): Fork menu item with capability gating

Trunk patch: SessionActionMenu adds optional onFork + forkSupported props; consumers wire forkSession + capability lookup.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 17: trunk-patches.md registry

**Files:**
- Create: `fork-features/trunk-patches.md`

- [ ] **Step 1: Write the registry**

```markdown
# Trunk patches owned by fork-features

These edits land in upstream files because no upstream register API exists.
Each rebase: re-read the corresponding upstream file, re-apply if conflicting,
remove if upstream provided a native register API or the feature is obsolete.

## session-fork

| File | Lines (approx) | Purpose | Notes |
|---|---|---|---|
| `shared/src/schemas.ts` | inside SessionMetadata zod | Add `forkedFrom?`, `forkedAt?` | Optional fields, fully backward-compatible |
| `shared/src/rpcMethods.ts` | one enum entry | Add `ForkSpawnSession: 'fork_spawn_session'` | |
| `cli/src/index.ts` | one import | `import '../../fork-features/session-fork/register'` | Side-effect to register providers |
| `cli/src/api/apiMachine.ts` | one handler block | Register `RPC_METHODS.ForkSpawnSession` handler calling `handleForkSpawnSession` | |
| `hub/src/web/server.ts` | 2 lines | `import { mountForkRoutes } …; mountForkRoutes(app, …)` | After other `app.route('/api', …)` calls |
| `web/src/hooks/mutations/useSessionActions.ts` | one return entry | `forkSession(srcId)` mutation | Mirrors archiveSession style |
| `web/src/components/SessionActionMenu.tsx` | one prop + one menu item | `onFork?` / `forkSupported?` + Fork item | Capability-gated |
```

- [ ] **Step 2: Commit**

```bash
git add fork-features/trunk-patches.md
git commit -m "docs(fork): register trunk patches for session-fork

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 18: Local typecheck + full test suite green

- [ ] **Step 1: Typecheck whole repo**

```
bun run typecheck
```
Expected: no errors. Fix any introduced ts errors before moving on.

- [ ] **Step 2: Full test suite**

```
bun run test
```
Expected: all pass.

- [ ] **Step 3: If green, commit any cleanup**

```bash
git add -A
git status
# only commit if there are leftover fmt/lint changes
```

---

### Task 19: E2E runtime verification (Claude)

Per `runtime-verification-required.rule.md`: no test suite green ≠ done. Web service must be exercised end-to-end via the `agent-browser` skill against a real local hub+cli+web stack.

- [ ] **Step 1: Start local hapi**

```
bun run dev    # or whatever the local dev orchestrator is — check package.json scripts
```
Wait until web is reachable at http://localhost:<web-port>.

- [ ] **Step 2: Use agent-browser to run the flow**

Invoke the `agent-browser` skill with the following script intent:

1. Open the hapi web UI
2. Create a new Claude session in a fresh cwd (e.g. `/tmp/hapi-fork-e2e`)
3. Send 3 messages: a plain "hello", a question that triggers a tool call (e.g. "list files in this directory"), then "ok thanks"
4. Open SessionActionMenu (three-dot button) on this session → click "Fork session"
5. Assert: new session appears in sidebar, title ends with " (fork)"
6. Click the new session — assert all 3 messages visible
7. In the new session, send "this is fork-only"; in the source session send "this is source-only"
8. Switch between the two — verify each only sees its own added message after the fork point
9. Inspect new session metadata (via `GET /api/sessions/<newId>` if exposed) — assert `forkedFrom` matches source id, `claudeSessionId` differs

- [ ] **Step 3: Capture evidence**

Save:
- Screenshot of sidebar with both sessions
- API response of source vs new (jq-formatted)
- agent-browser transcript

Store under `docs/superpowers/evidence/2026-06-28-session-fork-claude/`.

- [ ] **Step 4: Document outcome**

If anything fails: do NOT mark task complete. Open a fix loop:
1. Investigate root cause via logs (cli + hub)
2. Fix in code
3. Rerun Step 2 from scratch (not just the failing checkpoint)
4. Capture fresh evidence

---

### Task 20: E2E runtime verification (Codex)

Repeat Task 19's flow for a Codex session. Evidence dir: `docs/superpowers/evidence/2026-06-28-session-fork-codex/`.

Acceptance: same 9 checkpoints. Codex-specific extras:
- Inspect new session metadata `codexSessionId` and `codexThreadId` — both differ from source
- Verify Codex app-server log shows `thread/fork` followed by `thread/resume`

---

### Task 21: Sync-upstream dry run

Before declaring fork-features stable, prove the rebase tax is real but bounded.

- [ ] **Step 1: Run the sync-upstream workflow locally on a sandbox branch**

Per `fork-upstream-sync` skill — fetch upstream `tiann/hapi/main`, attempt rebase of the current branch.

- [ ] **Step 2: If conflicts, only the 7 trunk-patch files should be touched**

If conflicts appear in any other file, the fork-features extraction failed — investigate why a non-trunk-patch file is being conflicted on.

- [ ] **Step 3: Document the outcome in trunk-patches.md**

Add a `## Last rebase verified` line with date + upstream SHA.

---

## Acceptance Criteria (mirrors spec)

- [ ] cli unit tests pass (`claudeFork`, `codexFork`, `cliHandler`, `providerRegistry`, `register`, `rpcPayloads`)
- [ ] hub unit tests pass (`hubForkController`, `hubMount`, `hubSyncEngineAdapter`)
- [ ] web unit tests pass (`useFlavorCapabilities`, `useSessionActions.forkSession`, `SessionActionMenu` Fork item)
- [ ] E2E Claude fork: two independent sessions, evidence stored (Task 19)
- [ ] E2E Codex fork: two independent sessions, evidence stored (Task 20)
- [ ] cursor/gemini/opencode/kimi/omp sessions: Fork menu item absent
- [ ] Active turn in source → POST returns 409
- [ ] Source machine offline → POST returns 503 (verified by killing cli before POST)
- [ ] DB clone failure: source unchanged, no orphan new session row (covered by hubForkController test)
- [ ] `fork-features/trunk-patches.md` lists all 7 trunk patches
- [ ] Sync-upstream rebase only touches the 7 trunk-patch files (Task 21)
