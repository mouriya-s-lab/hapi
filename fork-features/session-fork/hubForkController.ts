import { getForkCapability, isForkCapableFlavor } from './forkCapabilities'

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
 * Minimal view of a source-session message that forkController needs to
 * (a) validate `forkPoint.messageId` belongs to the session + is a user turn,
 * (b) compute `tailOffset` = number of user turns strictly after the target.
 * Adapter maps hub `StoredMessage` to this shape.
 */
export interface ForkMessage {
    id: string
    seq: number
    role: string
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
    /**
     * Return the source session's messages ordered by ascending seq. Used
     * for `forkPoint` validation + `tailOffset` computation. Adapter maps
     * from hub `StoredMessage` (content JSON) to `{id, seq, role}`.
     */
    listMessages(sessionId: string): ForkMessage[]
    /**
     * Clone hub-DB messages from source to destination. `opts.beforeSeq`
     * restricts the copy to messages with `seq < beforeSeq` (STRICT: the
     * message at that seq is NOT copied). Used for per-message fork so the
     * new session's hub-DB transcript matches the state BEFORE the target
     * user message — the composer will then be prefilled with that message
     * text via #63 c6 fork-restore. Absent = full copy (backward-compat
     * with #55 HEAD fork).
     */
    copyMessages(
        srcSessionId: string,
        dstSessionId: string,
        opts?: { beforeSeq?: number }
    ): { copied: number }
    /**
     * Resolve the provider-native message id for id-based providers (Claude
     * `--resume-session-at <assistantUuid>`) when a `forkPoint` is present.
     * Walks the source's messages backward from `targetSeq - 1` to find the
     * last message the provider considers a fork-anchor (for Claude: the
     * immediately-preceding assistant-role output line, reading
     * `content.data.uuid` from hub's stored raw jsonl line). Returns
     * `undefined` when the flavor is count-based (Codex uses `tailOffset`
     * only) or when no anchor exists (target is the first user turn —
     * Claude then degrades to a HEAD-fork-of-empty which produces an empty
     * new session, matching the composer-prefill semantic).
     */
    resolveProviderMessageId(
        sessionId: string,
        targetSeq: number,
        flavor: string
    ): string | undefined
    updateMetadata(sessionId: string, metadataPatch: Record<string, any>): void
}

export interface ResolvedForkPoint {
    /** UI/UX primary key from REST body. */
    messageId: string
    /** Number of user turns strictly after target in the source session. */
    tailOffset: number
    /** Target message seq — hub-DB `copyMessages` uses this as `upToSeq`. */
    targetSeq: number
}

/**
 * Resolve REST-body `forkPoint.messageId` against the source session:
 *   - message id belongs to session AND role === 'user'   → resolved
 *   - not found                                            → 400 fork_point_not_found
 *   - role !== 'user'                                      → 400 fork_point_not_user_role
 *   - flavor capability.fork !== 'at-message'              → 400 flavor_does_not_support_per_message_fork
 * Pure function of deps + inputs; no side effects.
 */
function resolveForkPoint(
    deps: ForkDeps,
    srcSessionId: string,
    flavor: string,
    messageId: string
): ResolvedForkPoint {
    const cap = getForkCapability(flavor)
    if (cap.fork !== 'at-message') {
        throw new HttpError(
            400,
            `flavor ${flavor} does not support per-message fork (fork=${cap.fork})`
        )
    }
    const msgs = deps.listMessages(srcSessionId)
    const target = msgs.find((m) => m.id === messageId)
    if (!target) {
        throw new HttpError(400, `fork point not found: message ${messageId} does not belong to session ${srcSessionId}`)
    }
    if (target.role !== 'user') {
        throw new HttpError(400, `fork point must be a user message (message ${messageId} has role ${target.role})`)
    }
    const tailOffset = msgs.filter((m) => m.seq > target.seq && m.role === 'user').length
    return { messageId, tailOffset, targetSeq: target.seq }
}

export async function forkSession(args: {
    srcSessionId: string
    deps: ForkDeps
    /** Optional per-message fork target from REST body. Absent = HEAD fork (#55). */
    forkPoint?: { messageId: string }
}): Promise<{ newSessionId: string }> {
    const { srcSessionId, deps, forkPoint } = args

    const src = deps.getSession(srcSessionId)
    if (!src) {
        throw new HttpError(404, `session ${srcSessionId} not found`)
    }

    const flavor = typeof src.metadata?.flavor === 'string' ? src.metadata.flavor : null
    if (!flavor || !isForkCapableFlavor(flavor)) {
        throw new HttpError(400, `flavor ${flavor ?? '<none>'} does not support fork`)
    }

    // Per-message resolution runs BEFORE any provider RPC / DB write — a
    // rejected forkPoint must not leave a half-baked hapi session behind.
    const resolvedForkPoint =
        forkPoint !== undefined ? resolveForkPoint(deps, srcSessionId, flavor, forkPoint.messageId) : null

    // Resolve id-based provider anchor (Claude assistant uuid) when at-message
    // fork is requested. Undefined when the flavor is count-based (Codex uses
    // tailOffset alone) or when target is the first user turn.
    const providerMessageId =
        resolvedForkPoint !== null
            ? deps.resolveProviderMessageId(srcSessionId, resolvedForkPoint.targetSeq, flavor)
            : undefined

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
                sourceCollaborationMode: src.collaborationMode,
                ...(resolvedForkPoint
                    ? {
                          forkPoint: {
                              messageId: resolvedForkPoint.messageId,
                              tailOffset: resolvedForkPoint.tailOffset,
                              ...(providerMessageId !== undefined ? { providerMessageId } : {})
                          }
                      }
                    : {})
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
    // (Claude's --fork-session already branches the on-disk JSONL; this is
    // for hub's transcript view so the new hapi session shows the same
    // history). Per-message fork: clone messages STRICTLY BEFORE the target
    // seq — the target user message is what the user is rewinding to redo,
    // so it must not appear in the new session's transcript. The composer
    // in the new session is then prefilled with that message's text by #63
    // c6 fork-restore.
    try {
        deps.copyMessages(
            srcSessionId,
            newSessionId,
            resolvedForkPoint ? { beforeSeq: resolvedForkPoint.targetSeq } : undefined
        )
    } catch (err) {
        // Don't fail the whole operation: provider fork + new session exist;
        // missing transcript clone is a degraded state but not a leak.
    }

    // Step 4 — write fork lineage + display name. Provider's metadataPatch
    // (e.g. the new claudeSessionId / codexSessionId) is merged in case the
    // spawn flow hasn't populated it yet from the cli session-add event.
    // hapi's user-facing session title lives in MetadataSchema.name (set by
    // PATCH /sessions/:id rename), not `title` — write `name` so the UI
    // surfaces "<source> (fork)" in the list.
    const sourceName =
        typeof src.metadata?.name === 'string' && src.metadata.name.length > 0
            ? src.metadata.name
            : 'Untitled'
    try {
        deps.updateMetadata(newSessionId, {
            ...forkResult.metadataPatch,
            forkedFrom: srcSessionId,
            forkedAt: Date.now(),
            name: `${sourceName} (fork)`,
            ...(resolvedForkPoint ? { forkedFromMessageId: resolvedForkPoint.messageId } : {})
        })
    } catch (err) {
        // Same rationale: lineage metadata is nice-to-have, doesn't gate success.
    }

    return { newSessionId }
}
