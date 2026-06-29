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

        let buffer = ''
        let settled = false
        const finish = (fn: () => void) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            try {
                child.kill('SIGTERM')
            } catch {
                // best-effort
            }
            fn()
        }

        const timer = setTimeout(() => {
            finish(() => reject(new Error(`claude fork: timeout waiting for init message after ${timeoutMs}ms`)))
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
                if (
                    parsed?.type === 'system' &&
                    parsed?.subtype === 'init' &&
                    typeof parsed?.session_id === 'string' &&
                    parsed.session_id.length > 0
                ) {
                    finish(() => resolve({ newClaudeSessionId: parsed.session_id }))
                    return
                }
            }
        })

        child.on('error', (err) => {
            finish(() => reject(err))
        })

        child.on('exit', (code, signal) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            reject(new Error(`claude fork: process exited (code=${code}, signal=${signal}) without init message`))
        })
    })
}
