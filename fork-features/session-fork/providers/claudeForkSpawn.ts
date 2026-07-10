import { spawn } from 'node:child_process'
import type { SpawnClaudeForkArgs, SpawnClaudeForkResult } from './claudeFork'

export interface ClaudeForkSpawnConfig {
    claudeBin?: string
    initTimeoutMs?: number
}

/**
 * Build the CLI args for a one-shot claude fork spawn. Extracted for unit testing.
 *
 * Mirrors the shape used by cli/src/claude/sdk/query.ts (stream-json input/output
 * + --print + --resume <id>) and adds --fork-session to make claude branch the
 * existing session JSONL into a fresh session id at startup.
 *
 * If `providerMessageId` is present, additionally passes `--resume-session-at
 * <providerMessageId>` — Claude's undocumented per-message fork flag. Combined
 * with `--fork-session --resume <sourceSessionId>` it copies the source jsonl
 * up to and including the message with that uuid into the new session, then
 * continues from there. Hub controller populates `providerMessageId` by
 * resolving the target user message to the preceding assistant message uuid.
 */
export function buildClaudeForkCliArgs(args: SpawnClaudeForkArgs): string[] {
    const cliArgs = [
        '--resume', args.sourceSessionId,
        '--fork-session',
        '--print',
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
        '--verbose'
    ]
    if (args.providerMessageId) {
        cliArgs.push('--resume-session-at', args.providerMessageId)
    }
    if (args.model) cliArgs.push('--model', args.model)
    return cliArgs
}

function resolveClaudeBin(config: ClaudeForkSpawnConfig | undefined): string {
    if (config?.claudeBin) return config.claudeBin
    return process.env.HAPI_CLAUDE_PATH ?? 'claude'
}

/**
 * Spawn `claude --resume X --fork-session` as a one-shot, wait for the
 * stream-json `system/init` message that carries the new session_id, then
 * terminate the child. hapi will re-spawn a normal launcher for the new
 * session through its standard spawn path.
 */
export async function spawnClaudeFork(
    args: SpawnClaudeForkArgs,
    config?: ClaudeForkSpawnConfig
): Promise<SpawnClaudeForkResult> {
    const bin = resolveClaudeBin(config)
    const cliArgs = buildClaudeForkCliArgs(args)
    const timeoutMs = config?.initTimeoutMs ?? 15_000

    return new Promise<SpawnClaudeForkResult>((resolve, reject) => {
        const child = spawn(bin, cliArgs, {
            cwd: args.cwd,
            stdio: ['pipe', 'pipe', 'pipe']
        })

        // Send a minimal prompt then EOF. Empirically claude --fork-session
        // only materializes the new session's on-disk JSONL after it processes
        // at least one user turn — without a prompt it just runs SessionStart
        // hooks and exits with no fork file written. That breaks the hapi
        // launcher's `claude --resume <new-id>` step (file not found → process
        // exits code 1). A single-char prompt is the smallest valid stream-json
        // user message and produces a forked JSONL on disk in well under a
        // second on local claude.
        try {
            const minimalPrompt = JSON.stringify({
                type: 'user',
                message: { role: 'user', content: [{ type: 'text', text: '.' }] }
            }) + '\n'
            child.stdin?.write(minimalPrompt)
            child.stdin?.end()
        } catch {
            // best-effort
        }

        let buffer = ''
        let capturedSessionId: string | null = null
        let settled = false
        const settle = (fn: () => void) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            fn()
        }

        const timer = setTimeout(() => {
            // Hard cap. Kill the child to bound resource use, then reject
            // with whatever we knew at the time.
            try { child.kill('SIGTERM') } catch { /* best-effort */ }
            settle(() => {
                if (capturedSessionId) {
                    resolve({ newClaudeSessionId: capturedSessionId })
                } else {
                    reject(new Error(`claude fork: timeout waiting for forked session_id after ${timeoutMs}ms`))
                }
            })
        }, timeoutMs)

        child.stdout?.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf8')
            let nl: number
            // eslint-disable-next-line no-cond-assign
            while ((nl = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, nl).trim()
                buffer = buffer.slice(nl + 1)
                if (!line) continue
                let parsed: any
                try {
                    parsed = JSON.parse(line)
                } catch {
                    continue
                }
                // claude --fork-session emits the new session_id on every
                // stream-json line. Capture the first non-source one — but
                // wait for natural exit before resolving so the on-disk
                // forked JSONL is fully flushed before hapi's launcher tries
                // to `claude --resume <new-id>`.
                if (
                    !capturedSessionId &&
                    typeof parsed?.session_id === 'string' &&
                    parsed.session_id.length > 0 &&
                    parsed.session_id !== args.sourceSessionId
                ) {
                    capturedSessionId = parsed.session_id
                }
            }
        })

        child.on('error', (err) => {
            settle(() => reject(err))
        })

        child.on('exit', () => {
            settle(() => {
                if (capturedSessionId) {
                    resolve({ newClaudeSessionId: capturedSessionId })
                } else {
                    reject(new Error('claude fork: process exited without emitting a new session_id'))
                }
            })
        })
    })
}
