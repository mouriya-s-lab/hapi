import type { ForkDeps, ForkMessage, ForkSourceSession, ForkSpawnResultLike } from './hubForkController'

/**
 * Read `role` out of a `StoredMessage.content` JSON blob. hapi's message
 * content is `unknown` at the type layer, but conventionally `{role, content}`
 * (see hub/src/sync/messageService*.ts, hub/src/web/routes/*.ts). Anything
 * that doesn't fit falls through to 'unknown' so callers don't mistake
 * missing-role for user-role.
 */
function extractRole(content: unknown): string {
    if (content !== null && typeof content === 'object' && 'role' in content) {
        const role = (content as { role?: unknown }).role
        return typeof role === 'string' ? role : 'unknown'
    }
    return 'unknown'
}

/**
 * Extract the Claude native jsonl uuid from a `role: 'agent'` hub message
 * that wraps a Claude stream-json `type: 'output'` line, iff the wrapped
 * line is an `assistant` message. Hub stores the raw jsonl line at
 * `content.data`. Returns undefined for `agent` events that aren't
 * assistant output (ready events, tool_use lines nested inside data,
 * etc.) or for non-agent role messages.
 *
 * Used by `resolveProviderMessageId` to find the fork anchor to pass to
 * `claude --resume-session-at <uuid>`.
 */
function extractClaudeAssistantUuid(content: unknown): string | undefined {
    if (content === null || typeof content !== 'object') return undefined
    const role = (content as { role?: unknown }).role
    if (role !== 'agent') return undefined
    const cc = (content as { content?: unknown }).content
    if (cc === null || typeof cc !== 'object') return undefined
    if ((cc as { type?: unknown }).type !== 'output') return undefined
    const data = (cc as { data?: unknown }).data
    if (data === null || typeof data !== 'object') return undefined
    if ((data as { type?: unknown }).type !== 'assistant') return undefined
    const uuid = (data as { uuid?: unknown }).uuid
    return typeof uuid === 'string' && uuid.length > 0 ? uuid : undefined
}

/**
 * Adapts hub's Store + SyncEngine into the ForkDeps shape that forkController
 * speaks. Kept in fork-features so hub itself doesn't import from us — only
 * server.ts (T13 trunk patch) imports buildForkDeps + mountForkRoutes.
 *
 * `store` and `syncEngine` are typed as `any` deliberately: importing hub's
 * Store / SyncEngine classes would couple this module to hub internals.
 * Server.ts passes the real objects in.
 */
export function buildForkDeps(args: {
    store: any
    syncEngine: any
    namespace: string
}): ForkDeps {
    const { store, syncEngine, namespace } = args

    return {
        getSession(id: string): ForkSourceSession | null {
            const row = store.sessions.getSession(id)
            if (!row) return null
            const metadata = row.metadata ?? {}
            const cwd =
                typeof metadata?.path === 'string' && metadata.path.length > 0
                    ? metadata.path
                    : (typeof row.cwd === 'string' ? row.cwd : '')
            // hub's `sessions.machine_id` column is often null on rows created
            // through paths that only stash machineId inside metadata
            // (ROUTING_FIELDS preservation). Metadata is the authoritative
            // source — fall back to it before declaring the row machine-less.
            const machineId =
                (typeof row.machineId === 'string' && row.machineId.length > 0)
                    ? row.machineId
                    : (typeof metadata?.machineId === 'string' ? metadata.machineId : '')
            return {
                id: row.id,
                machineId,
                metadata,
                cwd,
                model: row.model ?? undefined,
                permissionMode: row.permissionMode ?? undefined,
                collaborationMode: row.collaborationMode ?? undefined
            }
        },

        async forkProvider(machineId, request): Promise<ForkSpawnResultLike> {
            const raw = await syncEngine.forkProviderSession(machineId, request)
            if (!raw || typeof raw !== 'object') {
                throw new Error('fork provider RPC returned non-object response')
            }
            const obj = raw as Record<string, unknown>
            if (typeof obj.providerSessionId !== 'string' || obj.providerSessionId.length === 0) {
                throw new Error('fork provider RPC response missing providerSessionId')
            }
            const metadataPatch = (typeof obj.metadataPatch === 'object' && obj.metadataPatch !== null)
                ? (obj.metadataPatch as Record<string, any>)
                : {}
            return { providerSessionId: obj.providerSessionId, metadataPatch }
        },

        async spawnSession(opts) {
            // SyncEngine.spawnSession positional signature:
            // (machineId, directory, agent, model?, modelReasoningEffort?, yolo?,
            //  sessionType?, worktreeName?, resumeSessionId?, effort?,
            //  permissionMode?, serviceTier?)
            return await syncEngine.spawnSession(
                opts.machineId,
                opts.cwd,
                opts.flavor,
                opts.model,
                undefined,
                undefined,
                undefined,
                undefined,
                opts.resumeSessionId,
                undefined,
                opts.permissionMode,
                undefined
            )
        },

        listMessages(sessionId: string): ForkMessage[] {
            const msgs = store.messages.getAllMessages(sessionId)
            return msgs.map((m: any) => ({
                id: m.id,
                seq: m.seq,
                role: extractRole(m.content)
            }))
        },

        copyMessages(srcId, dstId, opts) {
            const msgs = store.messages.getAllMessages(srcId)
            const beforeSeq = opts?.beforeSeq
            const selected =
                beforeSeq !== undefined ? msgs.filter((m: any) => m.seq < beforeSeq) : msgs
            for (const m of selected) {
                store.messages.copyMessageToSession(dstId, {
                    content: m.content,
                    createdAt: m.createdAt,
                    invokedAt: m.invokedAt ?? null,
                    localId: undefined,
                    scheduledAt: m.scheduledAt ?? null
                })
            }
            return { copied: selected.length }
        },

        resolveProviderMessageId(sessionId, targetSeq, flavor) {
            // Only Claude uses an id-based fork anchor today. Other flavors
            // are either count-based (Codex → tailOffset) or have no fork
            // primitive. Return undefined for them so controller omits the
            // field entirely.
            if (flavor !== 'claude') return undefined
            const msgs = store.messages.getAllMessages(sessionId)
            // Walk backward from the message immediately before target.
            for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i]
                if (typeof m?.seq !== 'number' || m.seq >= targetSeq) continue
                const uuid = extractClaudeAssistantUuid(m.content)
                if (uuid !== undefined) return uuid
            }
            // No preceding assistant message: target is the first user turn.
            // Undefined signals the Claude fork to fall back to HEAD fork,
            // which combined with beforeSeq=<targetSeq>=1 gives an empty
            // hub-DB transcript. This is the correct edge behavior — the
            // "rewound to the very first turn" case IS an empty session.
            return undefined
        },

        updateMetadata(sessionId, patch) {
            const existing = store.sessions.getSession(sessionId)
            if (!existing) return
            const currentVersion =
                typeof existing.metadataVersion === 'number' ? existing.metadataVersion : 0
            store.sessions.updateSessionMetadata(sessionId, patch, currentVersion, namespace)
        }
    }
}
