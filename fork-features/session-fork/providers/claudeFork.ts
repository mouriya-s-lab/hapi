import { randomUUID } from 'node:crypto'
import type { ForkProvider } from '../providerRegistry'
import type { ForkSpawnPayload, ForkSpawnResult } from '../rpcPayloads'

export interface SpawnClaudeForkArgs {
    sourceSessionId: string
    cwd: string
    model?: string
    /**
     * When present, passed to Claude as `--resume-session-at <providerMessageId>`
     * alongside `--fork-session --resume <sourceSessionId>`. Claude then
     * copies the source jsonl transcript up to and including the message
     * with this uuid into the new session and starts the next turn from
     * there. Absent = HEAD fork (all source messages copied).
     *
     * Hub controller resolves this uuid from the hub's messages table by
     * walking back from the target user message to the immediately-
     * preceding role=agent message and reading `content.data.uuid`.
     */
    providerMessageId?: string
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

export const claudeForkProvider: ForkProvider = {
    async spawnFork(payload: ForkSpawnPayload): Promise<ForkSpawnResult> {
        const sourceSessionId = payload.sourceMetadata.claudeSessionId
        if (!sourceSessionId) throw new Error('claude fork: sourceMetadata.claudeSessionId is required')
        if (!payload.forkPoint) {
            const { newClaudeSessionId } = await spawnClaudeForkImpl({
                sourceSessionId,
                cwd: payload.sourceCwd,
                model: payload.sourceModel
            })
            return { providerSessionId: newClaudeSessionId, metadataPatch: { claudeSessionId: newClaudeSessionId } }
        }
        const providerMessageId = payload.forkPoint.providerMessageId
        if (!providerMessageId) throw new Error('claude fork: providerMessageId is required for per-message fork')
        const newClaudeSessionId = randomUUID()
        return {
            providerSessionId: newClaudeSessionId,
            metadataPatch: { claudeSessionId: newClaudeSessionId },
            claudeLaunch: { sourceSessionId, providerMessageId }
        }
    }
}
