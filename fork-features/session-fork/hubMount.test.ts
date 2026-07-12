import { describe, it, expect, beforeEach } from 'bun:test'
import { Hono } from 'hono'
import { mountForkRoutes, type ForkSyncEngineLike } from './hubMount'
import { __resetRegistryForTests, registerForkProvider } from './providerRegistry'

function makeDeps(
    opts: {
        sourceMissing?: boolean
        spawnError?: string
        flavor?: string
        messages?: Array<{ id: string; seq: number; role: string }>
        forkProviderSpy?: (req: unknown) => void
        updateMetadataSpy?: (patch: Record<string, unknown>) => void
        copySpy?: (copyOpts: { beforeSeq?: number } | undefined) => void
        resolveProviderMessageIdImpl?: (sessionId: string, targetSeq: number, flavor: string) => any
    } = {}
): ForkSyncEngineLike {
    const flavor = opts.flavor ?? 'claude'
    return {
        getSession: () =>
            opts.sourceMissing
                ? null
                : {
                      id: 'src',
                      machineId: 'm',
                      metadata: { flavor, claudeSessionId: 'c', codexSessionId: 'cx', title: 'T' },
                      cwd: '/w'
                  },
        listMessages: () => opts.messages ?? [],
        async forkProvider(_machineId, request) {
            opts.forkProviderSpy?.(request)
            return { providerSessionId: 'cnew', metadataPatch: { claudeSessionId: 'cnew' } }
        },
        async spawnSession() {
            return opts.spawnError
                ? { type: 'error', message: opts.spawnError }
                : { type: 'success', sessionId: 'new-hapi-id' }
        },
        copyMessages: (_src, _dst, copyOpts) => {
            opts.copySpy?.(copyOpts)
            return { copied: 0 }
        },
        updateMetadata: (_id, patch) => {
            opts.updateMetadataSpy?.(patch)
        },
        resolveProviderMessageId: (sessionId, targetSeq, forkFlavor) =>
            opts.resolveProviderMessageIdImpl
                ? opts.resolveProviderMessageIdImpl(sessionId, targetSeq, forkFlavor)
                : undefined
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
    it('GET /api/flavors/capabilities returns the static two-dim capability map', async () => {
        // Hub serves the static capability map (not the cli-side registry,
        // which is per-process and empty in hub). The register.ts invariant
        // test pins that cli's registry covers exactly the flavors whose
        // fork slot is non-'none'.
        const app = new Hono()
        mountForkRoutes(app, () => makeDeps(), () => true, () => {})
        const res = await app.request('/api/flavors/capabilities')
        expect(res.status).toBe(200)
        const body = (await res.json()) as {
            capabilities: Record<string, { fork: string; files: string }>
        }
        expect(body.capabilities.claude).toEqual({ fork: 'at-message', files: 'none' })
        expect(body.capabilities.codex).toEqual({ fork: 'at-message', files: 'none' })
        expect(body.capabilities.cursor).toEqual({ fork: 'none', files: 'none' })
    })

    it('POST /api/sessions/:id/fork returns 200 + newSessionId on success', async () => {
        const app = new Hono()
        const transfers: Array<{ sessionId: string; accountId: number }> = []
        app.use('*', async (c, next) => { c.set('accountId' as never, 7 as never); await next() })
        mountForkRoutes(app, () => makeDeps(), () => true, (sessionId, accountId) => transfers.push({ sessionId, accountId }))
        const res = await app.request('/api/sessions/src/fork', { method: 'POST' })
        expect(res.status).toBe(200)
        const body = (await res.json()) as { newSessionId: string }
        expect(body.newSessionId).toBe('new-hapi-id')
        expect(transfers).toEqual([{ sessionId: 'new-hapi-id', accountId: 7 }])
    })

    it('rejects a fork without operator access to the source session', async () => {
        const app = new Hono()
        mountForkRoutes(app, () => makeDeps(), () => false, () => {})

        const res = await app.request('/api/sessions/src/fork', { method: 'POST' })

        expect(res.status).toBe(403)
    })

    it('passes the authenticated namespace into source-session authorization', async () => {
        const app = new Hono()
        app.use('*', async (c, next) => {
            c.set('namespace' as never, 'namespace-b' as never)
            c.set('accountId' as never, 1 as never)
            c.set('role' as never, 'user' as never)
            await next()
        })
        let authorizedNamespace = ''
        mountForkRoutes(app, () => makeDeps(), (_sessionId, namespace) => {
            authorizedNamespace = namespace
            return false
        }, () => {})

        const res = await app.request('/api/sessions/src/fork', { method: 'POST' })

        expect(res.status).toBe(403)
        expect(authorizedNamespace).toBe('namespace-b')
    })

    it('returns 404 when source session missing', async () => {
        const app = new Hono()
        mountForkRoutes(app, () => makeDeps({ sourceMissing: true }), () => true, () => {})
        const res = await app.request('/api/sessions/src/fork', { method: 'POST' })
        expect(res.status).toBe(404)
    })

    it('returns 500 when spawnSession errors', async () => {
        const app = new Hono()
        mountForkRoutes(app, () => makeDeps({ spawnError: 'machine offline' }), () => true, () => {})
        const res = await app.request('/api/sessions/src/fork', { method: 'POST' })
        expect(res.status).toBe(500)
    })

    it('returns 503 when sync engine not ready', async () => {
        const app = new Hono()
        mountForkRoutes(app, () => null, () => true, () => {})
        const res = await app.request('/api/sessions/src/fork', { method: 'POST' })
        expect(res.status).toBe(503)
    })

    it('POST body forkPoint.messageId → controller receives per-message fork request', async () => {
        const forkReqs: any[] = []
        const app = new Hono()
        mountForkRoutes(app, () =>
            makeDeps({
                flavor: 'codex',
                messages: [
                    { id: 'm1', seq: 1, role: 'user' },
                    { id: 'm2', seq: 2, role: 'agent' }
                ],
                forkProviderSpy: (req) => forkReqs.push(req)
            }),
            () => true,
            () => {}
        )
        const res = await app.request('/api/sessions/src/fork', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ forkPoint: { messageId: 'm1' } })
        })
        expect(res.status).toBe(200)
        expect(forkReqs).toHaveLength(1)
        expect((forkReqs[0] as any).payload.forkPoint).toEqual({
            messageId: 'm1',
            tailOffset: 0,
            isFirstUserTurn: true
        })
    })

    it('POST body without forkPoint → HEAD fork (backward-compat)', async () => {
        const forkReqs: any[] = []
        const app = new Hono()
        mountForkRoutes(app, () =>
            makeDeps({ forkProviderSpy: (req) => forkReqs.push(req) }),
            () => true,
            () => {}
        )
        const res = await app.request('/api/sessions/src/fork', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(res.status).toBe(200)
        expect((forkReqs[0] as any).payload.forkPoint).toBeUndefined()
    })

    it('POST body forkPoint.messageId non-existent → 400 with no session written', async () => {
        const app = new Hono()
        let copyCalled = false
        mountForkRoutes(app, () =>
            makeDeps({
                flavor: 'codex',
                messages: [{ id: 'real-id', seq: 1, role: 'user' }],
                copySpy: () => {
                    copyCalled = true
                }
            }),
            () => true,
            () => {}
        )
        const res = await app.request('/api/sessions/src/fork', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ forkPoint: { messageId: 'ghost-id' } })
        })
        expect(res.status).toBe(400)
        expect(copyCalled).toBe(false)
    })

    it('POST body forkPoint.messageId is assistant → 400 (role not user)', async () => {
        const app = new Hono()
        mountForkRoutes(app, () =>
            makeDeps({
                flavor: 'codex',
                messages: [{ id: 'm-agent', seq: 1, role: 'agent' }]
            }),
            () => true,
            () => {}
        )
        const res = await app.request('/api/sessions/src/fork', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ forkPoint: { messageId: 'm-agent' } })
        })
        expect(res.status).toBe(400)
    })

    it('POST claude flavor + forkPoint → 200 (at-message via --resume-session-at, resolveProviderMessageId consulted)', async () => {
        const forkPayloads: any[] = []
        const resolveCalls: any[] = []
        const app = new Hono()
        mountForkRoutes(app, () =>
            makeDeps({
                flavor: 'claude',
                messages: [
                    { id: 'm1', seq: 1, role: 'user' },
                    { id: 'm2', seq: 2, role: 'agent' },
                    { id: 'm3', seq: 3, role: 'user' }
                ],
                forkProviderSpy: (r) => forkPayloads.push(r),
                resolveProviderMessageIdImpl: (_sid, seq, flavor) => {
                    resolveCalls.push({ seq, flavor })
                    return flavor === 'claude'
                        ? { type: 'message-uuid', messageUuid: 'asst-native-uuid' }
                        : undefined
                }
            }),
            () => true,
            () => {}
        )
        const res = await app.request('/api/sessions/src/fork', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ forkPoint: { messageId: 'm3' } })
        })
        expect(res.status).toBe(200)
        expect(resolveCalls).toEqual([{ seq: 3, flavor: 'claude' }])
        expect((forkPayloads[0] as any).payload.forkPoint).toEqual({
            messageId: 'm3',
            tailOffset: 0,
            isFirstUserTurn: false,
            providerAnchor: { type: 'message-uuid', messageUuid: 'asst-native-uuid' }
        })
    })

    it('POST body forkPoint.messageId invalid shape → 400', async () => {
        const app = new Hono()
        mountForkRoutes(app, () => makeDeps({ flavor: 'codex' }), () => true, () => {})
        const res = await app.request('/api/sessions/src/fork', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ forkPoint: { messageId: '' } })
        })
        expect(res.status).toBe(400)
    })

    it('POST malformed JSON → 400 instead of silently running a HEAD fork', async () => {
        const forkReqs: unknown[] = []
        const app = new Hono()
        mountForkRoutes(app, () =>
            makeDeps({ forkProviderSpy: (request) => forkReqs.push(request) }),
            () => true,
            () => {}
        )
        const res = await app.request('/api/sessions/src/fork', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: 'not-json'
        })
        expect(res.status).toBe(400)
        expect(forkReqs).toHaveLength(0)
    })
})
