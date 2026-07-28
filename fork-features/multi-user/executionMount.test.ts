import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { createExecutionMiddleware, mountExecutionRoutes } from './executionMount'
import type { SyncEngine } from '../../hub/src/sync/syncEngine'
import type { WebAppEnv } from '../../hub/src/web/middleware/auth'
import { MultiUserGatewayStore } from './gatewayStore'
import { Store as HubStore } from '../../hub/src/store'
import { SSEManager } from '../../hub/src/sse/sseManager'
import { VisibilityTracker } from '../../hub/src/visibility/visibilityTracker'

describe('createExecutionMiddleware', () => {
    it('exposes authenticated account identity as opaque delivery metadata', async () => {
        const store = new MultiUserGatewayStore(':memory:')
        const owner = store.createAccount('owner', 'user', 'owner-namespace', null)
        store.bindResource({ resourceType: 'session', resourceId: 'owned', ownerAccountId: owner.id, coreNamespace: owner.defaultNamespace })
        const jwtSecret = new TextEncoder().encode('test-secret-test-secret-test-secret')
        const token = await new SignJWT({ gaid: owner.id }).setProtectedHeader({ alg: 'HS256' }).sign(jwtSecret)
        const app = new Hono<WebAppEnv>()
        app.use('*', createExecutionMiddleware({ store, jwtSecret }))
        app.post('/api/sessions/:id/messages', c => c.json(c.get('deliveryMetadata')))

        const response = await app.request('/api/sessions/owned/messages', {
            method: 'POST', headers: { authorization: `Bearer ${token}` }
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ gatewayAccountId: owner.id })
        store.close()
    })

    it('binds a fork-created session to the source session owner', async () => {
        const store = new MultiUserGatewayStore(':memory:')
        const owner = store.createAccount('owner', 'user', 'owner-namespace', null)
        store.bindResource({
            resourceType: 'session',
            resourceId: 'source-session',
            ownerAccountId: owner.id,
            coreNamespace: owner.defaultNamespace
        })
        const jwtSecret = new TextEncoder().encode('test-secret-test-secret-test-secret')
        const token = await new SignJWT({ gaid: owner.id })
            .setProtectedHeader({ alg: 'HS256' })
            .sign(jwtSecret)
        const app = new Hono()
        app.use('*', createExecutionMiddleware({ store, jwtSecret }))
        app.post('/api/sessions/:id/fork', (c) => c.json({ newSessionId: 'fork-session' }))

        const response = await app.request('/api/sessions/source-session/fork', {
            method: 'POST',
            headers: { authorization: `Bearer ${token}` }
        })

        expect(response.status).toBe(200)
        expect(store.getResource('session', 'fork-session')).toMatchObject({
            ownerAccountId: owner.id,
            coreNamespace: owner.defaultNamespace
        })
        store.close()
    })

    for (const path of ['resume', 'reopen', 'restart'] as const) {
        it(`binds a ${path}-created replacement session to the source session owner`, async () => {
            const store = new MultiUserGatewayStore(':memory:')
            const owner = store.createAccount('owner', 'user', 'owner-namespace', null)
            store.bindResource({
                resourceType: 'session',
                resourceId: 'source-session',
                ownerAccountId: owner.id,
                coreNamespace: owner.defaultNamespace
            })
            const jwtSecret = new TextEncoder().encode('test-secret-test-secret-test-secret')
            const token = await new SignJWT({ gaid: owner.id })
                .setProtectedHeader({ alg: 'HS256' })
                .sign(jwtSecret)
            const app = new Hono()
            app.use('*', createExecutionMiddleware({ store, jwtSecret }))
            app.post(`/api/sessions/:id/${path}`, (c) => c.json({ sessionId: `${path}-session` }))

            const response = await app.request(`/api/sessions/source-session/${path}`, {
                method: 'POST',
                headers: { authorization: `Bearer ${token}` }
            })

            expect(response.status).toBe(200)
            expect(store.getResource('session', `${path}-session`)).toMatchObject({
                ownerAccountId: owner.id,
                coreNamespace: owner.defaultNamespace
            })
            store.close()
        })
    }

    it('omits stale resource bindings whose core session no longer exists', async () => {
        const store = new MultiUserGatewayStore(':memory:')
        const owner = store.createAccount('owner', 'user', 'owner-namespace', null)
        store.bindResource({
            resourceType: 'session',
            resourceId: 'deleted-source-session',
            ownerAccountId: owner.id,
            coreNamespace: owner.defaultNamespace
        })
        const jwtSecret = new TextEncoder().encode('test-secret-test-secret-test-secret')
        const token = await new SignJWT({ gaid: owner.id })
            .setProtectedHeader({ alg: 'HS256' })
            .sign(jwtSecret)
        const engine = {
            getSessionsByNamespace: () => [],
            getSession: () => undefined
        } as unknown as SyncEngine
        const app = new Hono<WebAppEnv>()
        mountExecutionRoutes(app, {
            store,
            jwtSecret,
            getSyncEngine: () => engine,
            getSseManager: () => null,
            getStore: () => null
        })

        const response = await app.request('/api/sessions', {
            headers: { authorization: `Bearer ${token}` }
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ sessions: [] })
        store.close()
    })
    it('streams only granted cross-namespace session events to a viewer', async () => {
        const store = new MultiUserGatewayStore(':memory:')
        const owner = store.createAccount('owner', 'user', 'owner-namespace', null)
        const viewer = store.createAccount('viewer', 'user', 'viewer-namespace', null)
        store.bindResource({
            resourceType: 'session',
            resourceId: 'shared-session',
            ownerAccountId: owner.id,
            coreNamespace: owner.defaultNamespace
        })
        store.grant('session', 'shared-session', viewer.id, 'viewer')
        const jwtSecret = new TextEncoder().encode('test-secret-test-secret-test-secret')
        const token = await new SignJWT({ gaid: viewer.id })
            .setProtectedHeader({ alg: 'HS256' })
            .sign(jwtSecret)
        const sseManager = new SSEManager(0, new VisibilityTracker())
        const app = new Hono<WebAppEnv>()
        mountExecutionRoutes(app, {
            store,
            jwtSecret,
            getSyncEngine: () => null,
            getSseManager: () => sseManager,
            getStore: () => null
        })
        const controller = new AbortController()
        const response = await app.request('/api/events', {
            headers: { authorization: `Bearer ${token}` },
            signal: controller.signal
        })
        const reader = response.body?.getReader()
        expect(reader).toBeDefined()
        const first = await reader!.read()
        expect(new TextDecoder().decode(first.value)).toContain('"status":"connected"')

        sseManager.broadcast({
            type: 'session-updated',
            sessionId: 'private-session',
            namespace: owner.defaultNamespace
        })
        sseManager.broadcast({
            type: 'session-updated',
            sessionId: 'shared-session',
            namespace: owner.defaultNamespace
        })
        const event = await reader!.read()
        const body = new TextDecoder().decode(event.value)
        expect(body).toContain('"sessionId":"shared-session"')
        expect(body).not.toContain('private-session')

        controller.abort()
        await reader!.cancel()
        sseManager.stop()
        store.close()
    })
})

describe('列表可见性：admin 看整个 namespace，普通用户看自己的+被授权的', () => {
    const jwtSecret = new TextEncoder().encode('test-secret-test-secret-test-secret')
    const sign = (accountId: number) => new SignJWT({ gaid: accountId }).setProtectedHeader({ alg: 'HS256' }).sign(jwtSecret)

    /** 建一个 namespace 里有 3 个会话、2 台机器的场景：admin 拥有 1 个，peter 拥有 2 个。 */
    function seed() {
        const store = new MultiUserGatewayStore(':memory:')
        const admin = store.createAccount('admin', 'admin', 'default', null)
        const peter = store.createAccount('peter', 'user', 'default', null)
        const other = store.createAccount('mnmn66', 'user', 'default', null)
        const sessions = [
            { id: 's-admin', ownerAccountId: admin.id },
            { id: 's-peter-1', ownerAccountId: peter.id },
            { id: 's-peter-2', ownerAccountId: peter.id }
        ]
        for (const s of sessions) {
            store.bindResource({ resourceType: 'session', resourceId: s.id, ownerAccountId: s.ownerAccountId, coreNamespace: 'default' })
        }
        store.bindResource({ resourceType: 'machine', resourceId: 'm-admin', ownerAccountId: admin.id, coreNamespace: 'default' })
        store.bindResource({ resourceType: 'machine', resourceId: 'm-peter', ownerAccountId: peter.id, coreNamespace: 'default' })

        const records = new Map(sessions.map(s => [s.id, { id: s.id, namespace: 'default', metadata: null, agentState: null, active: false, createdAt: 1, updatedAt: 1, seq: 0 }]))
        const machines = [{ id: 'm-admin', namespace: 'default' }, { id: 'm-peter', namespace: 'default' }]
        const engine = {
            getSessionsByNamespace: () => [...records.values()],
            getSession: (id: string) => records.get(id),
            getOnlineMachinesByNamespace: () => machines,
            getMachine: (id: string) => machines.find(m => m.id === id) ?? null
        } as unknown as SyncEngine

        const app = new Hono<WebAppEnv>()
        mountExecutionRoutes(app, { store, jwtSecret, getSyncEngine: () => engine, getSseManager: () => null, getStore: () => null })
        return { store, app, admin, peter, other }
    }

    const idsOf = async (response: Response, key: 'sessions' | 'machines') =>
        ((await response.json()) as Record<string, Array<{ id: string }>>)[key]!.map(r => r.id).sort()

    it('admin 的会话列表包含别人拥有的会话（pre-gateway 行为，收敛后曾丢失 56 条）', async () => {
        const { store, app, admin } = seed()
        const response = await app.request('/api/sessions', { headers: { authorization: `Bearer ${await sign(admin.id)}` } })
        expect(response.status).toBe(200)
        expect(await idsOf(response, 'sessions')).toEqual(['s-admin', 's-peter-1', 's-peter-2'])
        store.close()
    })

    it('admin 的机器列表同样是整个 namespace', async () => {
        const { store, app, admin } = seed()
        const response = await app.request('/api/machines', { headers: { authorization: `Bearer ${await sign(admin.id)}` } })
        expect(await idsOf(response, 'machines')).toEqual(['m-admin', 'm-peter'])
        store.close()
    })

    it('普通用户仍然只看到自己拥有的 —— admin 分支没有放宽别人的可见性', async () => {
        const { store, app, peter } = seed()
        const sessions = await app.request('/api/sessions', { headers: { authorization: `Bearer ${await sign(peter.id)}` } })
        expect(await idsOf(sessions, 'sessions')).toEqual(['s-peter-1', 's-peter-2'])
        const machines = await app.request('/api/machines', { headers: { authorization: `Bearer ${await sign(peter.id)}` } })
        expect(await idsOf(machines, 'machines')).toEqual(['m-peter'])
        store.close()
    })

    it('被授权的资源出现在普通用户列表里，未授权的不出现', async () => {
        const { store, app, other } = seed()
        store.grant('session', 's-peter-1', other.id, 'viewer')
        const response = await app.request('/api/sessions', { headers: { authorization: `Bearer ${await sign(other.id)}` } })
        // mnmn66 自己不拥有任何会话，只应看到被授权的那一条
        expect(await idsOf(response, 'sessions')).toEqual(['s-peter-1'])
        store.close()
    })
})

describe('/api/usage/summary：可见性与会话列表同构，聚合走真实 hub Store', () => {
    const jwtSecret = new TextEncoder().encode('test-secret-test-secret-test-secret')
    const sign = (accountId: number) => new SignJWT({ gaid: accountId }).setProtectedHeader({ alg: 'HS256' }).sign(jwtSecret)

    function usageEnvelope(messageId: string, inputTokens: number) {
        return {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    timestamp: '2026-07-20T10:00:00.000Z',
                    message: {
                        id: messageId,
                        model: 'claude-fable-5',
                        usage: { input_tokens: inputTokens, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
                    }
                }
            }
        }
    }

    /** admin 1 个会话（100 tokens，机器 vircs），peter 2 个会话（各 10 tokens，机器 peter-mac）。 */
    function seedUsage() {
        const gateway = new MultiUserGatewayStore(':memory:')
        const admin = gateway.createAccount('admin', 'admin', 'default', null)
        const peter = gateway.createAccount('peter', 'user', 'default', null)
        const other = gateway.createAccount('mnmn66', 'user', 'default', null)

        const hubStore = new HubStore(':memory:')
        const specs = [
            { id: 's-admin', owner: admin.id, host: 'vircs', tokens: 100 },
            { id: 's-peter-1', owner: peter.id, host: 'peter-mac', tokens: 10 },
            { id: 's-peter-2', owner: peter.id, host: 'peter-mac', tokens: 10 }
        ]
        for (const spec of specs) {
            hubStore.sessions.getOrCreateSession(`tag-${spec.id}`, { path: `/tmp/${spec.id}`, host: spec.host }, null, 'default', undefined, undefined, undefined, spec.id)
            hubStore.messages.addMessage(spec.id, usageEnvelope(`msg-${spec.id}`, spec.tokens))
            gateway.bindResource({ resourceType: 'session', resourceId: spec.id, ownerAccountId: spec.owner, coreNamespace: 'default' })
        }

        const records = new Map(specs.map(spec => [spec.id, {
            id: spec.id, namespace: 'default', metadata: { path: `/tmp/${spec.id}`, host: spec.host }, agentState: null, active: false, createdAt: 1, updatedAt: 1, seq: 0
        }]))
        const engine = {
            getSessionsByNamespace: () => [...records.values()],
            getSession: (id: string) => records.get(id)
        } as unknown as SyncEngine

        const app = new Hono<WebAppEnv>()
        mountExecutionRoutes(app, { store: gateway, jwtSecret, getSyncEngine: () => engine, getSseManager: () => null, getStore: () => hubStore })
        return { gateway, hubStore, app, admin, peter, other }
    }

    type UsageResponse = {
        models: Array<{ model: string; requestCount: number; inputTokens: number }>
        totals: { requestCount: number; inputTokens: number }
        hosts: string[]
    }

    it('admin 统计覆盖整个 namespace（含别人拥有的会话）', async () => {
        const { gateway, app, admin } = seedUsage()
        const response = await app.request('/api/usage/summary', { headers: { authorization: `Bearer ${await sign(admin.id)}` } })
        expect(response.status).toBe(200)
        const body = await response.json() as UsageResponse
        expect(body.totals).toMatchObject({ requestCount: 3, inputTokens: 120 })
        expect(body.hosts).toEqual(['peter-mac', 'vircs'])
        gateway.close()
    })

    it('普通用户只统计自己拥有的会话，机器下拉不泄漏他人机器', async () => {
        const { gateway, app, peter } = seedUsage()
        const response = await app.request('/api/usage/summary', { headers: { authorization: `Bearer ${await sign(peter.id)}` } })
        const body = await response.json() as UsageResponse
        expect(body.totals).toMatchObject({ requestCount: 2, inputTokens: 20 })
        expect(body.hosts).toEqual(['peter-mac'])
        gateway.close()
    })

    it('被授权 viewer 能统计到被授权那一条会话的用量', async () => {
        const { gateway, app, other } = seedUsage()
        gateway.grant('session', 's-peter-1', other.id, 'viewer')
        const response = await app.request('/api/usage/summary', { headers: { authorization: `Bearer ${await sign(other.id)}` } })
        const body = await response.json() as UsageResponse
        expect(body.totals).toMatchObject({ requestCount: 1, inputTokens: 10 })
        gateway.close()
    })

    it('host 筛选把统计范围限到该机器的会话', async () => {
        const { gateway, app, admin } = seedUsage()
        const response = await app.request('/api/usage/summary?host=vircs', { headers: { authorization: `Bearer ${await sign(admin.id)}` } })
        const body = await response.json() as UsageResponse
        expect(body.totals).toMatchObject({ requestCount: 1, inputTokens: 100 })
        gateway.close()
    })

    it('未认证请求得到 401', async () => {
        const { gateway, app } = seedUsage()
        const response = await app.request('/api/usage/summary')
        expect(response.status).toBe(401)
        gateway.close()
    })
})
