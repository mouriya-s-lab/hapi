import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Machine, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createImportableSessionsRoutes } from './importableSessions'

const machine = {
    id: 'machine-1', namespace: 'default', seq: 1, createdAt: 1, updatedAt: 1,
    active: true, activeAt: 1, metadata: { host: 'localhost', platform: 'darwin', happyCliVersion: '1' },
    metadataVersion: 1, runnerState: null, runnerStateVersion: 1
} as Machine

function appFor(engine: Partial<SyncEngine>) {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => { c.set('namespace', 'default'); await next() })
    app.route('/api', createImportableSessionsRoutes(() => engine as SyncEngine))
    return app
}

const externalSessionId = '11111111-1111-4111-8111-111111111111'

describe('importable session routes', () => {
    it('forwards directory, content, and cursor filters and joins provider identity', async () => {
        const requests: unknown[] = []
        const app = appFor({
            getMachine: () => machine,
            listImportableSessionsForMachine: async (_machineId, request) => {
                requests.push(request)
                return { sessions: [{ provider: 'codex', externalSessionId, cwd: '/work', title: 'Title', preview: 'Prompt', updatedAt: 1 }], nextCursor: null }
            },
            getSessionsByNamespace: () => [{ id: 'hapi-1', metadata: { machineId: 'machine-1', codexSessionId: externalSessionId } }] as never
        })
        const response = await app.request('/api/machines/machine-1/importable-sessions?provider=codex&cwd=%2Fwork&query=needle&cursor=next')
        expect(await response.json()).toEqual({
            sessions: [{ provider: 'codex', externalSessionId, cwd: '/work', title: 'Title', preview: 'Prompt', updatedAt: 1, importedHapiSessionId: 'hapi-1' }],
            nextCursor: null
        })
        expect(requests).toEqual([{ provider: 'codex', cwd: '/work', query: 'needle', cursor: 'next' }])
    })

    it('returns an existing provider session on the same machine', async () => {
        let imported = false
        const app = appFor({
            getMachine: () => machine,
            getSessionsByNamespace: () => [{ id: 'hapi-1', metadata: { machineId: 'machine-1', claudeSessionId: externalSessionId } }] as never,
            importProviderSessionForMachine: async () => { imported = true; return { type: 'success', sessionId: 'new', messageCount: 1 } }
        })
        const response = await app.request(`/api/machines/machine-1/importable-sessions/claude/${externalSessionId}`, { method: 'POST' })
        expect(await response.json()).toEqual({ type: 'success', sessionId: 'hapi-1', alreadyImported: true })
        expect(imported).toBe(false)
    })

    it('does not offer Open for a provider UUID owned by another machine', async () => {
        const app = appFor({
            getMachine: () => machine,
            listImportableSessionsForMachine: async () => ({
                sessions: [{ provider: 'codex', externalSessionId, cwd: '/work', title: 'Title', preview: null, updatedAt: 1 }],
                nextCursor: null
            }),
            getSessionsByNamespace: () => [{ id: 'other', metadata: { machineId: 'machine-2', codexSessionId: externalSessionId } }] as never
        })
        const response = await app.request('/api/machines/machine-1/importable-sessions?provider=codex')
        const body = await response.json() as { sessions: Array<{ importedHapiSessionId: string | null }> }
        expect(body.sessions[0].importedHapiSessionId).toBeNull()
    })

    it('rejects a provider UUID already owned by another machine', async () => {
        let imported = false
        const app = appFor({
            getMachine: () => machine,
            getSessionsByNamespace: () => [{ id: 'other', metadata: { machineId: 'machine-2', codexSessionId: externalSessionId } }] as never,
            importProviderSessionForMachine: async () => { imported = true; return { type: 'success', sessionId: 'new', messageCount: 1 } }
        })
        const response = await app.request(`/api/machines/machine-1/importable-sessions/codex/${externalSessionId}`, { method: 'POST' })
        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({ type: 'error', error: 'Provider session UUID is already owned by another machine' })
        expect(imported).toBe(false)
    })

    it('imports directly through the machine without spawning an agent session', async () => {
        const calls: unknown[][] = []
        const app = appFor({
            getMachine: () => machine,
            getSessionsByNamespace: () => [] as never,
            importProviderSessionForMachine: async (...args: unknown[]) => {
                calls.push(args)
                return { type: 'success', sessionId: 'direct-import', messageCount: 12 }
            }
        })
        const response = await app.request(`/api/machines/machine-1/importable-sessions/codex/${externalSessionId}`, { method: 'POST' })
        expect(await response.json()).toEqual({ type: 'success', sessionId: 'direct-import', alreadyImported: false })
        expect(calls).toEqual([['machine-1', 'codex', externalSessionId]])
    })

    it('coalesces concurrent imports across machine ids by provider UUID', async () => {
        let imports = 0
        let release!: () => void
        const gate = new Promise<void>((resolve) => { release = resolve })
        const app = appFor({
            getMachine: () => machine,
            getSessionsByNamespace: () => [] as never,
            importProviderSessionForMachine: async () => {
                imports += 1
                await gate
                return { type: 'success', sessionId: 'direct-import', messageCount: 1 }
            }
        })
        const url = `/api/machines/machine-1/importable-sessions/codex/${externalSessionId}`
        const first = app.request(url, { method: 'POST' })
        const second = app.request(url, { method: 'POST' })
        release()
        expect(await (await first).json()).toEqual({ type: 'success', sessionId: 'direct-import', alreadyImported: false })
        expect(await (await second).json()).toEqual({ type: 'success', sessionId: 'direct-import', alreadyImported: false })
        expect(imports).toBe(1)
    })

    it('deletes an inactive partial session when direct import fails', async () => {
        const deleted: string[] = []
        const app = appFor({
            getMachine: () => machine,
            getSessionsByNamespace: () => [] as never,
            importProviderSessionForMachine: async () => ({ type: 'error', error: 'invalid transcript', sessionId: 'partial' }),
            deleteSession: async (sessionId) => { deleted.push(sessionId) }
        })
        const response = await app.request(`/api/machines/machine-1/importable-sessions/claude/${externalSessionId}`, { method: 'POST' })
        expect(response.status).toBe(500)
        expect(await response.json()).toEqual({ type: 'error', error: 'invalid transcript' })
        expect(deleted).toEqual(['partial'])
    })

    it('rejects malformed provider session IDs before import', async () => {
        let imported = false
        const app = appFor({
            getMachine: () => machine,
            importProviderSessionForMachine: async () => { imported = true; return { type: 'not-found' } }
        })
        const response = await app.request('/api/machines/machine-1/importable-sessions/codex/not-a-uuid', { method: 'POST' })
        expect(response.status).toBe(400)
        expect(imported).toBe(false)
    })
})
