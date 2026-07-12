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
                const imported = existing.find((candidate) => candidate.metadata && externalSessionId(candidate.metadata, parsed.data) === session.externalSessionId)
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
        const duplicate = engine.getSessionsByNamespace(namespace).find((candidate) => candidate.metadata && externalSessionId(candidate.metadata, agent) === sourceId)
        if (duplicate) return c.json({ type: 'success', sessionId: duplicate.id, alreadyImported: true } satisfies ImportExistingSessionResponse)

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
        await engine.renameSession(spawned.sessionId, source.previewTitle)
        return c.json({ type: 'success', sessionId: spawned.sessionId, alreadyImported: false } satisfies ImportExistingSessionResponse)
    })

    return app
}
