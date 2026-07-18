import { Hono } from 'hono'
import { z } from 'zod'
import type { ImportExistingSessionResponse, ImportableSessionProvider, ImportableSessionsPage } from '@hapi/protocol/apiTypes'
import type { Metadata } from '@hapi/protocol/types'
import type { SyncEngine } from '../../../hub/src/sync/syncEngine'
import type { WebAppEnv } from '../../../hub/src/web/middleware/auth'
import { requireMachine } from '../../../hub/src/web/routes/guards'

const ProviderSchema = z.enum(['claude', 'codex'])
const ExternalSessionIdSchema = z.uuid()

function providerSessionId(metadata: Metadata, provider: ImportableSessionProvider): string | null {
    return provider === 'codex' ? metadata.codexSessionId ?? null : metadata.claudeSessionId ?? null
}

export function createImportableSessionsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const imports = new Map<string, Promise<ImportExistingSessionResponse>>()

    app.get('/machines/:id/importable-sessions', async (c) => {
        const engine = getSyncEngine()
        if (!engine) return c.json({ error: 'Not connected' }, 503)
        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) return machine
        const parsed = ProviderSchema.safeParse(c.req.query('provider'))
        if (!parsed.success) return c.json({ error: 'Invalid provider' }, 400)
        const provider = parsed.data
        const page = await engine.listImportableSessionsForMachine(machineId, {
            provider,
            cursor: c.req.query('cursor'),
            cwd: c.req.query('cwd')?.trim() || undefined,
            query: c.req.query('query')?.trim() || undefined
        })
        const existing = engine.getSessionsByNamespace(c.get('namespace'))
        return c.json({
            sessions: page.sessions.map((session) => ({
                ...session,
                importedHapiSessionId: existing.find((candidate) => candidate.metadata
                    && candidate.metadata.machineId === machineId
                    && providerSessionId(candidate.metadata, provider) === session.externalSessionId)?.id ?? null
            })),
            nextCursor: page.nextCursor
        } satisfies ImportableSessionsPage)
    })

    app.post('/machines/:id/importable-sessions/:provider/:externalSessionId', async (c) => {
        const engine = getSyncEngine()
        if (!engine) return c.json({ type: 'error', error: 'Not connected' } satisfies ImportExistingSessionResponse, 503)
        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) return machine
        const providerResult = ProviderSchema.safeParse(c.req.param('provider'))
        if (!providerResult.success) return c.json({ type: 'error', error: 'Invalid provider' } satisfies ImportExistingSessionResponse, 400)
        const idResult = ExternalSessionIdSchema.safeParse(c.req.param('externalSessionId'))
        if (!idResult.success) return c.json({ type: 'error', error: 'Invalid provider session ID' } satisfies ImportExistingSessionResponse, 400)
        const provider = providerResult.data
        const externalSessionId = idResult.data
        const namespace = c.get('namespace')
        const existing = engine.getSessionsByNamespace(namespace).find((candidate) => candidate.metadata
            && providerSessionId(candidate.metadata, provider) === externalSessionId)
        if (existing?.metadata?.machineId !== undefined && existing.metadata.machineId !== machineId) {
            return c.json({ type: 'error', error: 'Provider session UUID is already owned by another machine' } satisfies ImportExistingSessionResponse, 409)
        }
        if (existing) return c.json({ type: 'success', sessionId: existing.id, alreadyImported: true } satisfies ImportExistingSessionResponse)

        const key = `${namespace}:${provider}:${externalSessionId}`
        const active = imports.get(key)
        if (active) {
            const result = await active
            return c.json(result, result.type === 'success' ? 200 : 500)
        }

        const operation = (async (): Promise<ImportExistingSessionResponse> => {
            const result = await engine.importProviderSessionForMachine(machineId, provider, externalSessionId)
            if (result.type === 'success') return { type: 'success', sessionId: result.sessionId, alreadyImported: false }
            if (result.type === 'not-found') return { type: 'error', error: 'Provider session not found' }
            if (result.sessionId) {
                await engine.deleteSession(result.sessionId)
            }
            return { type: 'error', error: result.error }
        })()
        imports.set(key, operation)
        try {
            const result = await operation
            return c.json(result, result.type === 'success' ? 200 : 500)
        } finally {
            imports.delete(key)
        }
    })

    return app
}
