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

describe('importable session routes', () => {
    it('joins provider identity without exposing machine paths beyond cwd', async () => {
        const requests: unknown[] = []
        const app = appFor({
            getMachine: () => machine,
            listImportableSessionsForMachine: async (_machineId, request) => {
                requests.push(request)
                return ({
                sessions: [{ provider: 'codex', externalSessionId: 'thread-1', cwd: '/work', title: 'Title', preview: 'Prompt', updatedAt: 1 }],
                nextCursor: null
                })
            },
            getSessionsByNamespace: () => [{ id: 'hapi-1', metadata: { codexSessionId: 'thread-1' } }] as never
        })
        const response = await app.request('/api/machines/machine-1/importable-sessions?provider=codex&cwd=%2Fwork&query=needle&cursor=next')
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            sessions: [{ provider: 'codex', externalSessionId: 'thread-1', cwd: '/work', title: 'Title', preview: 'Prompt', updatedAt: 1, importedHapiSessionId: 'hapi-1' }],
            nextCursor: null
        })
        expect(requests).toEqual([{ provider: 'codex', cwd: '/work', query: 'needle', cursor: 'next' }])
    })

    it('returns an existing canonical Hapi session without spawning', async () => {
        let spawned = false
        const app = appFor({
            getMachine: () => machine,
            getSessionsByNamespace: () => [{ id: 'hapi-1', metadata: { claudeSessionId: '11111111-1111-4111-8111-111111111111' } }] as never,
            spawnSession: async () => { spawned = true; return { type: 'success', sessionId: 'new' } }
        })
        const response = await app.request('/api/machines/machine-1/importable-sessions/claude/11111111-1111-4111-8111-111111111111', { method: 'POST' })
        expect(await response.json()).toEqual({ type: 'success', sessionId: 'hapi-1', alreadyImported: true })
        expect(spawned).toBe(false)
    })

    it('resolves the provider session on the machine before spawning resume', async () => {
        const calls: unknown[][] = []
        const app = appFor({
            getMachine: () => machine,
            getSessionsByNamespace: () => [] as never,
            resolveImportableSessionForMachine: async () => ({
                type: 'success',
                session: { provider: 'claude', externalSessionId: '11111111-1111-4111-8111-111111111111', cwd: '/work', title: 'Title', preview: null, updatedAt: 1 }
            }),
            getSession: () => ({ active: true, metadata: { claudeSessionId: '11111111-1111-4111-8111-111111111111' } }) as never,
            spawnSession: async (...args: unknown[]) => { calls.push(args); return { type: 'success', sessionId: 'new-hapi' } }
        })
        const response = await app.request('/api/machines/machine-1/importable-sessions/claude/11111111-1111-4111-8111-111111111111', { method: 'POST' })
        expect(await response.json()).toEqual({ type: 'success', sessionId: 'new-hapi', alreadyImported: false })
        expect(calls[0]?.[0]).toBe('machine-1')
        expect(calls[0]?.[1]).toBe('/work')
        expect(calls[0]?.[8]).toBe('11111111-1111-4111-8111-111111111111')
    })

    it('coalesces concurrent imports of the same provider session', async () => {
        let spawned = 0
        let releaseResolve!: () => void
        const resolveGate = new Promise<void>((resolve) => { releaseResolve = resolve })
        const app = appFor({
            getMachine: () => machine,
            getSessionsByNamespace: () => [] as never,
            resolveImportableSessionForMachine: async () => {
                await resolveGate
                return {
                    type: 'success',
                    session: { provider: 'codex', externalSessionId: '11111111-1111-4111-8111-111111111111', cwd: '/work', title: 'Title', preview: null, updatedAt: 1 }
                }
            },
            getSession: () => ({ active: true, metadata: { codexSessionId: '11111111-1111-4111-8111-111111111111' } }) as never,
            spawnSession: async () => { spawned += 1; return { type: 'success', sessionId: 'new-hapi' } }
        })
        const url = '/api/machines/machine-1/importable-sessions/codex/11111111-1111-4111-8111-111111111111'
        const first = app.request(url, { method: 'POST' })
        const second = app.request(url, { method: 'POST' })
        releaseResolve()

        expect(await (await first).json()).toEqual({ type: 'success', sessionId: 'new-hapi', alreadyImported: false })
        expect(await (await second).json()).toEqual({ type: 'success', sessionId: 'new-hapi', alreadyImported: false })
        expect(spawned).toBe(1)
    })

    it('rejects malformed provider session IDs before resolution', async () => {
        let resolved = false
        const app = appFor({
            getMachine: () => machine,
            resolveImportableSessionForMachine: async () => { resolved = true; return { type: 'not-found' } }
        })
        const response = await app.request('/api/machines/machine-1/importable-sessions/codex/not-a-uuid', { method: 'POST' })

        expect(response.status).toBe(400)
        expect(resolved).toBe(false)
    })
})
