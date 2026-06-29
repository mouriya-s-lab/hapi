import { describe, it, expect, beforeEach } from 'bun:test'
import { Hono } from 'hono'
import { mountForkRoutes, type ForkSyncEngineLike } from './hubMount'
import { __resetRegistryForTests, registerForkProvider } from './providerRegistry'

function makeDeps(opts: { activeTurn?: boolean; sourceMissing?: boolean } = {}): ForkSyncEngineLike {
    return {
        getSession: () =>
            opts.sourceMissing
                ? null
                : {
                      id: 'src',
                      machineId: 'm',
                      metadata: { flavor: 'claude', claudeSessionId: 'c', title: 'T' },
                      cwd: '/w'
                  },
        hasActiveTurn: () => !!opts.activeTurn,
        generateSessionId: () => 'new-id',
        async machineRpc() {
            return { providerSessionId: 'cnew', metadataPatch: { claudeSessionId: 'cnew' } }
        },
        insertSession: () => {},
        copyMessages: () => ({ copied: 0 }),
        killLauncher: async () => {},
        async tx(fn) {
            return fn() as any
        }
    }
}

beforeEach(() => {
    __resetRegistryForTests()
    registerForkProvider('claude', {
        async spawnFork() {
            return { providerSessionId: 'x', metadataPatch: {} }
        }
    })
})

describe('mountForkRoutes', () => {
    it('GET /api/flavors/capabilities returns registered flavors', async () => {
        const app = new Hono()
        mountForkRoutes(app, () => makeDeps())
        const res = await app.request('/api/flavors/capabilities')
        expect(res.status).toBe(200)
        const body = await res.json() as { fork: string[] }
        expect(body.fork).toContain('claude')
    })

    it('POST /api/sessions/:id/fork returns 200 + newSessionId on success', async () => {
        const app = new Hono()
        mountForkRoutes(app, () => makeDeps())
        const res = await app.request('/api/sessions/src/fork', { method: 'POST' })
        expect(res.status).toBe(200)
        const body = await res.json() as { newSessionId: string }
        expect(body.newSessionId).toBe('new-id')
    })

    it('returns 409 when source session has active turn', async () => {
        const app = new Hono()
        mountForkRoutes(app, () => makeDeps({ activeTurn: true }))
        const res = await app.request('/api/sessions/src/fork', { method: 'POST' })
        expect(res.status).toBe(409)
    })

    it('returns 404 when source session missing', async () => {
        const app = new Hono()
        mountForkRoutes(app, () => makeDeps({ sourceMissing: true }))
        const res = await app.request('/api/sessions/src/fork', { method: 'POST' })
        expect(res.status).toBe(404)
    })

    it('returns 503 when sync engine not ready', async () => {
        const app = new Hono()
        mountForkRoutes(app, () => null)
        const res = await app.request('/api/sessions/src/fork', { method: 'POST' })
        expect(res.status).toBe(503)
    })
})
