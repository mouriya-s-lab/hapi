import type { ForkDeps, ForkMessage, ForkSourceSession, ForkSpawnResultLike } from './hubForkController'
import { ForkSpawnResultSchema } from './rpcPayloads'

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
    const providerMessageId = (data as { providerMessageId?: unknown }).providerMessageId
    return typeof providerMessageId === 'string' && providerMessageId.length > 0 ? providerMessageId : undefined
}

function extractClaudeAssistantApiMessageId(content: unknown): string | undefined {
    if (content === null || typeof content !== 'object') return undefined
    if ((content as { role?: unknown }).role !== 'agent') return undefined
    const cc = (content as { content?: unknown }).content
    if (cc === null || typeof cc !== 'object' || (cc as { type?: unknown }).type !== 'output') return undefined
    const data = (cc as { data?: unknown }).data
    if (data === null || typeof data !== 'object' || (data as { type?: unknown }).type !== 'assistant') return undefined
    const message = (data as { message?: unknown }).message
    if (message === null || typeof message !== 'object') return undefined
    const id = (message as { id?: unknown }).id
    return typeof id === 'string' && id.length > 0 ? id : undefined
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
            return ForkSpawnResultSchema.parse(raw)
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
                undefined,
                opts.claudeLaunch
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
                if (uuid !== undefined) return { type: 'message-uuid', messageUuid: uuid }
                const assistantMessageId = extractClaudeAssistantApiMessageId(m.content)
                if (assistantMessageId !== undefined) {
                    return { type: 'assistant-api-message-id', assistantMessageId }
                }
            }
            // No preceding provider anchor. The controller rejects this before
            // any provider RPC so the provider cannot silently turn an
            // at-message rewind into a HEAD fork.
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
