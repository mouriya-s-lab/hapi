import type { ForkDeps, ForkSourceSession, ForkSpawnResultLike } from './hubForkController'

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

        copyMessages(srcId, dstId) {
            const msgs = store.messages.getAllMessages(srcId)
            for (const m of msgs) {
                store.messages.copyMessageToSession(dstId, {
                    content: m.content,
                    createdAt: m.createdAt,
                    invokedAt: m.invokedAt ?? null,
                    localId: undefined,
                    scheduledAt: m.scheduledAt ?? null
                })
            }
            return { copied: msgs.length }
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
