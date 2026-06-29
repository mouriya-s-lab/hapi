import { listForkCapableFlavors } from './providerRegistry'

export class HttpError extends Error {
    constructor(public status: number, message: string) {
        super(message)
        this.name = 'HttpError'
    }
}

/**
 * Subset of a hub session row that forkController needs. Mapped from a real
 * StoredSession by hubSyncEngineAdapter; kept here so forkController stays
 * decoupled from hub/src/store types.
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

export interface ForkSpawnResultLike {
    providerSessionId: string
    metadataPatch: Record<string, any>
}

/**
 * Pure-data view of hub runtime that forkController calls into. Lets us
 * unit-test all branches with plain stubs (no hub imports leak into the
 * controller's module graph).
 */
export interface ForkDeps {
    getSession(id: string): ForkSourceSession | null
    /**
     * Trigger the provider-native fork on the source's runner machine.
     * Returns the new provider session id + any metadata fields the provider
     * wants written onto the new hapi session row.
     */
    forkProvider(
        machineId: string,
        request: { flavor: string; payload: unknown }
    ): Promise<ForkSpawnResultLike>
    /**
     * Reuse hub's existing spawnSession path with resumeSessionId set to the
     * forked provider session id. Hub creates the hapi session row + spawns
     * the launcher; returns the freshly-allocated hapi session id.
     */
    spawnSession(args: {
        machineId: string
        cwd: string
        flavor: string
        model?: string
        permissionMode?: string
        collaborationMode?: string
        resumeSessionId: string
    }): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }>
    copyMessages(srcSessionId: string, dstSessionId: string): { copied: number }
    updateMetadata(sessionId: string, metadataPatch: Record<string, any>): void
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

    // Step 1 — provider-native fork on the source machine.
    let forkResult: ForkSpawnResultLike
    try {
        forkResult = await deps.forkProvider(src.machineId, {
            flavor,
            payload: {
                sourceMetadata: src.metadata,
                sourceCwd: src.cwd,
                sourceModel: src.model,
                sourcePermissionMode: src.permissionMode,
                sourceCollaborationMode: src.collaborationMode
            }
        })
    } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown provider error'
        throw new HttpError(502, `provider fork failed: ${message}`)
    }

    // Step 2 — reuse the standard spawn flow with the forked provider session
    // id. Hub allocates the hapi session row + brings up the runner; we use
    // the returned sessionId as the canonical hapi id for the fork.
    const spawnResult = await deps.spawnSession({
        machineId: src.machineId,
        cwd: src.cwd,
        flavor,
        model: src.model,
        permissionMode: src.permissionMode,
        collaborationMode: src.collaborationMode,
        resumeSessionId: forkResult.providerSessionId
    })
    if (spawnResult.type !== 'success') {
        throw new HttpError(500, `fork spawn failed: ${spawnResult.message}`)
    }
    const newSessionId = spawnResult.sessionId

    // Step 3 — clone visible message history. Independent of provider fork
    // (Claude's --fork-session already branches the on-disk JSONL; this is for
    // hub's transcript view so the new hapi session shows the same history).
    try {
        deps.copyMessages(srcSessionId, newSessionId)
    } catch (err) {
        // Don't fail the whole operation: provider fork + new session exist;
        // missing transcript clone is a degraded state but not a leak.
    }

    // Step 4 — write fork lineage + title. Provider's metadataPatch (e.g. the
    // new claudeSessionId / codexSessionId) is merged in case the spawn flow
    // hasn't populated it yet from the cli session-add event.
    const sourceTitle =
        typeof src.metadata?.title === 'string' ? src.metadata.title : 'Untitled'
    try {
        deps.updateMetadata(newSessionId, {
            ...forkResult.metadataPatch,
            forkedFrom: srcSessionId,
            forkedAt: Date.now(),
            title: `${sourceTitle} (fork)`
        })
    } catch (err) {
        // Same rationale: lineage metadata is nice-to-have, doesn't gate success.
    }

    return { newSessionId }
}
