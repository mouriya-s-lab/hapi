import { Hono } from 'hono'
import { z } from 'zod'
import type { ImportExistingSessionResponse, ImportableSessionProvider, ImportableSessionsPage } from '@hapi/protocol/apiTypes'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireMachine } from './guards'

const ProviderSchema = z.enum(['claude', 'codex'])
const ExternalSessionIdSchema = z.uuid()

function providerSessionId(metadata: NonNullable<ReturnType<SyncEngine['getSessionsByNamespace']>[number]['metadata']>, provider: ImportableSessionProvider): string | null {
    return provider === 'codex' ? metadata.codexSessionId ?? null : metadata.claudeSessionId ?? null
}

async function waitForProviderAttachment(
    engine: SyncEngine,
    sessionId: string,
    provider: ImportableSessionProvider,
    externalSessionId: string
): Promise<boolean> {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
        const session = engine.getSession(sessionId)
        if (session?.metadata && providerSessionId(session.metadata, provider) === externalSessionId) return true
        if (session && !session.active) return false
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return false
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
        const page = await engine.listImportableSessionsForMachine(machineId, provider, c.req.query('cursor'))
        const existing = engine.getSessionsByNamespace(c.get('namespace'))
        return c.json({
            sessions: page.sessions.map((session) => ({
                ...session,
                importedHapiSessionId: existing.find((candidate) => candidate.metadata && providerSessionId(candidate.metadata, provider) === session.externalSessionId)?.id ?? null
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
        const parsed = ProviderSchema.safeParse(c.req.param('provider'))
        if (!parsed.success) return c.json({ type: 'error', error: 'Invalid provider' } satisfies ImportExistingSessionResponse, 400)
        const provider = parsed.data
        const parsedId = ExternalSessionIdSchema.safeParse(c.req.param('externalSessionId'))
        if (!parsedId.success) return c.json({ type: 'error', error: 'Invalid provider session ID' } satisfies ImportExistingSessionResponse, 400)
        const externalSessionId = parsedId.data
        const namespace = c.get('namespace')
        const key = `${namespace}:${machineId}:${provider}:${externalSessionId}`
        const active = imports.get(key)
        if (active) {
            const result = await active
            return c.json(result, result.type === 'success' ? 200 : 500)
        }
        const operation = (async (): Promise<ImportExistingSessionResponse> => {
            const existing = engine.getSessionsByNamespace(namespace).find((candidate) => candidate.metadata && providerSessionId(candidate.metadata, provider) === externalSessionId)
            if (existing) return { type: 'success', sessionId: existing.id, alreadyImported: true }
            const resolved = await engine.resolveImportableSessionForMachine(machineId, provider, externalSessionId)
            if (resolved.type === 'not-found') return { type: 'error', error: 'Provider session not found' }
            const spawned = await engine.spawnSession(machineId, resolved.session.cwd, provider, undefined, undefined, undefined, undefined, undefined, externalSessionId)
            if (spawned.type === 'error') return { type: 'error', error: spawned.message }
            if (!await waitForProviderAttachment(engine, spawned.sessionId, provider, externalSessionId)) {
                return { type: 'error', error: 'Provider session did not attach to the Hapi session' }
            }
            return { type: 'success', sessionId: spawned.sessionId, alreadyImported: false }
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
