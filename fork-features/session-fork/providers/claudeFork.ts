import type { ForkProvider } from '../providerRegistry'
import type { ForkSpawnPayload, ForkSpawnResult } from '../rpcPayloads'

export interface SpawnClaudeForkArgs {
    sourceSessionId: string
    cwd: string
    model?: string
    newHapiSessionId: string
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
        if (!sourceSessionId) {
            throw new Error('claude fork: sourceMetadata.claudeSessionId is required')
        }
        const { newClaudeSessionId } = await spawnClaudeForkImpl({
            sourceSessionId,
            cwd: payload.sourceCwd,
            model: payload.sourceModel,
            newHapiSessionId: payload.newHapiSessionId
        })
        return {
            providerSessionId: newClaudeSessionId,
            metadataPatch: { claudeSessionId: newClaudeSessionId }
        }
    }
}
