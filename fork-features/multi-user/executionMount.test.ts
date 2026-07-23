import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { createExecutionMiddleware, mountExecutionRoutes } from './executionMount'
import type { SyncEngine } from '../../hub/src/sync/syncEngine'
import type { WebAppEnv } from '../../hub/src/web/middleware/auth'
import { MultiUserGatewayStore } from './gatewayStore'

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
            getSseManager: () => null
        })

        const response = await app.request('/api/sessions', {
            headers: { authorization: `Bearer ${token}` }
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ sessions: [] })
        store.close()
    })
})
