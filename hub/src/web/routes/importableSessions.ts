import { Hono } from 'hono'
import { z } from 'zod'
import type { ImportableSessionAgent, ImportableSessionsResponse, ImportExistingSessionResponse } from '@hapi/protocol/apiTypes'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireMachine } from './guards'

const AgentSchema = z.enum(['claude', 'codex'])

function externalSessionId(metadata: NonNullable<ReturnType<SyncEngine['getSessionsByNamespace']>[number]['metadata']>, agent: ImportableSessionAgent): string | null {
    return agent === 'codex' ? metadata.codexSessionId ?? null : metadata.claudeSessionId ?? null
}

export function createImportableSessionsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const importLocks = new Map<string, Promise<void>>()

    app.get('/machines/:id/importable-sessions', async (c) => {
        const engine = getSyncEngine()
        if (!engine) return c.json({ error: 'Not connected' }, 503)
        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) return machine
        const parsed = AgentSchema.safeParse(c.req.query('agent'))
        if (!parsed.success) return c.json({ error: 'Invalid agent' }, 400)

        const result = await engine.listImportableSessionsForMachine(machineId, parsed.data, c.req.query('cursor'))
        const namespace = c.get('namespace')
        const existing = engine.getSessionsByNamespace(namespace)
        const response: ImportableSessionsResponse = {
            sessions: result.sessions.map((session) => {
                const imported = existing.find((candidate) => candidate.metadata?.importHistoryState === 'complete' && !candidate.metadata.archivedAt && externalSessionId(candidate.metadata, parsed.data) === session.externalSessionId)
                return { ...session, alreadyImported: Boolean(imported), importedHapiSessionId: imported?.id ?? null }
            }),
            nextCursor: result.nextCursor
        }
        return c.json(response)
    })

    app.post('/machines/:id/importable-sessions/:agent/:externalSessionId/import', async (c) => {
        const engine = getSyncEngine()
        if (!engine) return c.json({ type: 'error', error: 'Not connected' } satisfies ImportExistingSessionResponse, 503)
        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) return machine
        const parsed = AgentSchema.safeParse(c.req.param('agent'))
        if (!parsed.success) return c.json({ type: 'error', error: 'Invalid agent' } satisfies ImportExistingSessionResponse, 400)
        const agent = parsed.data
        const sourceId = c.req.param('externalSessionId')
        const namespace = c.get('namespace')
        const lockKey = `${namespace}:${machineId}:${agent}:${sourceId}`
        const previous = importLocks.get(lockKey) ?? Promise.resolve()
        let release!: () => void
        const gate = new Promise<void>((resolve) => { release = resolve })
        const queued = previous.then(() => gate)
        importLocks.set(lockKey, queued)
        await previous
        try {
            const duplicate = engine.getSessionsByNamespace(namespace).find((candidate) => candidate.metadata && externalSessionId(candidate.metadata, agent) === sourceId)
            if (duplicate) {
                if (duplicate.metadata?.importHistoryState === 'complete' && !duplicate.metadata.archivedAt) {
                    return c.json({ type: 'success', sessionId: duplicate.id, alreadyImported: true } satisfies ImportExistingSessionResponse)
                }
                if (duplicate.metadata?.importHistoryState === undefined) {
                    return c.json({ type: 'error', error: 'Provider session is attached to an existing Hapi session that was not fully imported' } satisfies ImportExistingSessionResponse, 409)
                }
                const importState = duplicate.metadata?.importHistoryState === 'replaying' ? await engine.waitForImportHistoryComplete(duplicate.id) : 'failed'
                if (importState === 'complete' && !duplicate.metadata?.archivedAt) {
                    return c.json({ type: 'success', sessionId: duplicate.id, alreadyImported: true } satisfies ImportExistingSessionResponse)
                }
                await engine.archiveSession(duplicate.id)
            }

            const resolved = await engine.resolveImportableSessionForMachine(machineId, agent, sourceId)
            if (resolved.type === 'error') return c.json({ type: 'error', error: resolved.error } satisfies ImportExistingSessionResponse, 404)
            const source = resolved.session
            if (!source.cwd) return c.json({ type: 'error', error: 'Importable session has no working directory' } satisfies ImportExistingSessionResponse, 409)

            const spawned = await engine.spawnSession(
                machineId, source.cwd, agent, undefined, undefined, undefined, undefined, undefined,
                sourceId, undefined, undefined, undefined, undefined, true, resolved.transcriptPath, false
            )
            if (spawned.type === 'error') return c.json({ type: 'error', error: spawned.message } satisfies ImportExistingSessionResponse, 500)
            const active = await engine.waitForSessionActive(spawned.sessionId)
            if (!active) return c.json({ type: 'error', error: 'Imported session did not become active' } satisfies ImportExistingSessionResponse, 500)
            const importState = await engine.waitForImportHistoryComplete(spawned.sessionId)
            if (importState !== 'complete') return c.json({ type: 'error', error: 'Imported session ended before history replay completed' } satisfies ImportExistingSessionResponse, 500)
            await engine.renameSession(spawned.sessionId, source.previewTitle)
            return c.json({ type: 'success', sessionId: spawned.sessionId, alreadyImported: false } satisfies ImportExistingSessionResponse)
        } finally {
            release()
            if (importLocks.get(lockKey) === queued) importLocks.delete(lockKey)
        }
    })

    return app
}
