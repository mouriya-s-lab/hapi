import { getForkProvider } from './providerRegistry'
import { ForkSpawnPayloadSchema, type ForkSpawnResult } from './rpcPayloads'

export interface ForkSpawnRpcRequest {
    flavor: string
    payload: unknown
}

/**
 * Cli-side RPC handler body for RPC_METHODS.ForkSpawnSession.
 * Invoked from cli/src/api/apiMachine.ts; kept here so the dispatch logic
 * (parse payload → look up provider → call spawnFork) lives next to the
 * registry in fork-features and the trunk patch in apiMachine.ts stays
 * to a single registerHandler call.
 */
export async function handleForkSpawnSession(req: ForkSpawnRpcRequest): Promise<ForkSpawnResult> {
    if (!req || typeof req.flavor !== 'string' || req.flavor.length === 0) {
        throw new Error('fork: flavor is required')
    }
    const provider = getForkProvider(req.flavor)
    if (!provider) {
        throw new Error(`fork: no fork provider registered for flavor ${req.flavor}`)
    }
    const payload = ForkSpawnPayloadSchema.parse(req.payload)
    return provider.spawnFork(payload)
}
