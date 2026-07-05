import { describe, it, expect, beforeEach } from 'bun:test'
import { Hono } from 'hono'
import { mountForkRoutes, type ForkSyncEngineLike } from './hubMount'
import { __resetRegistryForTests, registerForkProvider } from './providerRegistry'

function makeDeps(opts: { sourceMissing?: boolean; spawnError?: string } = {}): ForkSyncEngineLike {
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
        async forkProvider() {
            return { providerSessionId: 'cnew', metadataPatch: { claudeSessionId: 'cnew' } }
        },
        async spawnSession() {
            return opts.spawnError
                ? { type: 'error', message: opts.spawnError }
                : { type: 'success', sessionId: 'new-hapi-id' }
        },
        copyMessages: () => ({ copied: 0 }),
        updateMetadata: () => {}
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
    it('GET /api/flavors/capabilities returns FORK_CAPABLE_FLAVORS', async () => {
        // Hub serves the static capability list (not the cli-side registry,
        // which is per-process and empty in hub). The register.ts invariant
        // test pins that cli's registry equals this list.
        const app = new Hono()
        mountForkRoutes(app, () => makeDeps())
        const res = await app.request('/api/flavors/capabilities')
        expect(res.status).toBe(200)
        const body = (await res.json()) as { fork: string[] }
        expect(body.fork.sort()).toEqual(['claude', 'codex'])
    })

    it('POST /api/sessions/:id/fork returns 200 + newSessionId on success', async () => {
        const app = new Hono()
        mountForkRoutes(app, () => makeDeps())
        const res = await app.request('/api/sessions/src/fork', { method: 'POST' })
        expect(res.status).toBe(200)
        const body = (await res.json()) as { newSessionId: string }
        expect(body.newSessionId).toBe('new-hapi-id')
    })

    it('returns 404 when source session missing', async () => {
        const app = new Hono()
        mountForkRoutes(app, () => makeDeps({ sourceMissing: true }))
        const res = await app.request('/api/sessions/src/fork', { method: 'POST' })
        expect(res.status).toBe(404)
    })

    it('returns 500 when spawnSession errors', async () => {
        const app = new Hono()
        mountForkRoutes(app, () => makeDeps({ spawnError: 'machine offline' }))
        const res = await app.request('/api/sessions/src/fork', { method: 'POST' })
        expect(res.status).toBe(500)
    })

    it('returns 503 when sync engine not ready', async () => {
        const app = new Hono()
        mountForkRoutes(app, () => null)
        const res = await app.request('/api/sessions/src/fork', { method: 'POST' })
        expect(res.status).toBe(503)
    })
})
