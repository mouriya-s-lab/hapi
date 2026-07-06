import type { ForkProvider } from '../providerRegistry'
import type { ForkSpawnPayload, ForkSpawnResult } from '../rpcPayloads'

export interface SpawnClaudeForkArgs {
    sourceSessionId: string
    cwd: string
    model?: string
}

export interface SpawnClaudeForkResult {
    newClaudeSessionId: string
}

export type SpawnClaudeFork = (args: SpawnClaudeForkArgs) => Promise<SpawnClaudeForkResult>

const NOT_WIRED: SpawnClaudeFork = async () => {
    throw new Error('claude fork: spawnClaudeFork not wired; call wireClaudeForkSpawn() at startup')
}

let spawnClaudeForkImpl: SpawnClaudeFork = NOT_WIRED

export function wireClaudeForkSpawn(impl: SpawnClaudeFork): void {
    spawnClaudeForkImpl = impl
}

export function __setSpawnClaudeForkForTests(impl: SpawnClaudeFork): void {
    spawnClaudeForkImpl = impl
}

export function __resetSpawnClaudeForkForTests(): void {
    spawnClaudeForkImpl = NOT_WIRED
}

/**
 * Emitted when a caller passes `forkPoint` to Claude's fork provider — Claude
 * CLI's native `--fork-session` flag only forks at HEAD (see `claude --help`:
 * "When resuming, create a new session ID instead of reusing the original")
 * so hapi declares `fork: 'head-only'` for the Claude flavor (#58
 * FlavorForkCapability). Hub controller maps this error class to 400.
 */
export class ClaudeForkNotAtMessageError extends Error {
    readonly code = 'claude_fork_head_only'
    constructor() {
        super(
            'claude flavor does not support per-message fork: `claude --fork-session` forks at HEAD only. Use session-level fork (no forkPoint) to fork from the current head.'
        )
        this.name = 'ClaudeForkNotAtMessageError'
    }
}

export const claudeForkProvider: ForkProvider = {
    async spawnFork(payload: ForkSpawnPayload): Promise<ForkSpawnResult> {
        if (payload.forkPoint) {
            // Second-line defence: hub controller (#61 c4) rejects at 400
            // before reaching us, but a direct caller (test, CLI RPC round-
            // trip, future consumer) could still land a forkPoint here.
            throw new ClaudeForkNotAtMessageError()
        }
        const sourceSessionId = payload.sourceMetadata.claudeSessionId
        if (!sourceSessionId) {
            throw new Error('claude fork: sourceMetadata.claudeSessionId is required')
        }
        const { newClaudeSessionId } = await spawnClaudeForkImpl({
            sourceSessionId,
            cwd: payload.sourceCwd,
            model: payload.sourceModel
        })
        return {
            providerSessionId: newClaudeSessionId,
            metadataPatch: { claudeSessionId: newClaudeSessionId }
        }
    }
}
