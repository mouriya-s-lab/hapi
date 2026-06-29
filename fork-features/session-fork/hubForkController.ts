import { listForkCapableFlavors } from './providerRegistry'
import type { ForkSpawnResult } from './rpcPayloads'

export class HttpError extends Error {
    constructor(public status: number, message: string) {
        super(message)
        this.name = 'HttpError'
    }
}

/**
 * Subset of a hub session row that forkController needs. Defined here so the
 * controller stays decoupled from hub/src/store internal types. The hub-side
 * adapter (hubSyncEngineAdapter.ts) maps StoredSession into this shape.
 */
export interface ForkSourceSession {
    id: string
    machineId: string
    metadata: Record<string, any>
    cwd: string
    model?: string
    permissionMode?: string
    collaborationMode?: string
}

/**
 * Everything forkController needs from the hub runtime. Pure data + functions;
 * no hub-internal classes leak in. Lets the controller be unit-tested with
 * plain stubs.
 */
export interface ForkDeps {
    getSession(id: string): ForkSourceSession | null
    hasActiveTurn(id: string): boolean
    generateSessionId(): string
    machineRpc(machineId: string, method: string, payload: unknown): Promise<ForkSpawnResult>
    insertSession(row: {
        id: string
        machineId: string
        metadata: Record<string, any>
        cwd: string
        model?: string
        permissionMode?: string
        collaborationMode?: string
    }): void
    copyMessages(srcSessionId: string, dstSessionId: string): { copied: number }
    killLauncher(machineId: string, providerSessionId: string): Promise<void>
    tx<T>(fn: () => T | Promise<T>): Promise<T>
}

export async function forkSession(args: {
    srcSessionId: string
    deps: ForkDeps
}): Promise<{ newSessionId: string }> {
    const { srcSessionId, deps } = args

    const src = deps.getSession(srcSessionId)
    if (!src) {
        throw new HttpError(404, `session ${srcSessionId} not found`)
    }

    const flavor = typeof src.metadata?.flavor === 'string' ? src.metadata.flavor : null
    const capableFlavors = listForkCapableFlavors()
    if (!flavor || !capableFlavors.includes(flavor)) {
        throw new HttpError(
            400,
            `flavor ${flavor ?? '<none>'} does not support fork (supported: ${capableFlavors.join(', ') || 'none'})`
        )
    }

    if (deps.hasActiveTurn(srcSessionId)) {
        throw new HttpError(409, 'source session has an active turn; wait for it to complete')
    }

    const newSessionId = deps.generateSessionId()

    let rpcResult: ForkSpawnResult
    try {
        rpcResult = await deps.machineRpc(src.machineId, 'fork-spawn-session', {
            flavor,
            payload: {
                sourceMetadata: src.metadata,
                sourceCwd: src.cwd,
                sourceModel: src.model,
                sourcePermissionMode: src.permissionMode,
                sourceCollaborationMode: src.collaborationMode,
                newHapiSessionId: newSessionId
            }
        })
    } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown provider error'
        throw new HttpError(502, `provider fork failed: ${message}`)
    }

    try {
        await deps.tx(async () => {
            const newMetadata: Record<string, any> = {
                ...src.metadata,
                ...rpcResult.metadataPatch,
                forkedFrom: srcSessionId,
                forkedAt: Date.now()
            }
            const sourceTitle =
                typeof src.metadata?.title === 'string' ? src.metadata.title : 'Untitled'
            newMetadata.title = `${sourceTitle} (fork)`

            deps.insertSession({
                id: newSessionId,
                machineId: src.machineId,
                metadata: newMetadata,
                cwd: src.cwd,
                model: src.model,
                permissionMode: src.permissionMode,
                collaborationMode: src.collaborationMode
            })
            deps.copyMessages(srcSessionId, newSessionId)
        })
    } catch (err) {
        // DB write failed after provider already forked → orphan provider thread.
        // Best-effort kill so we don't leak runner state.
        deps.killLauncher(src.machineId, rpcResult.providerSessionId).catch(() => undefined)
        const message = err instanceof Error ? err.message : 'unknown db error'
        throw new HttpError(500, `fork db write failed: ${message}`)
    }

    return { newSessionId }
}
