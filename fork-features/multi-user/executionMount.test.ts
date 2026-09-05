import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { createExecutionMiddleware, mountExecutionRoutes } from './executionMount'
import type { SyncEngine } from '../../hub/src/sync/syncEngine'
import type { WebAppEnv } from '../../hub/src/web/middleware/auth'
import { MultiUserGatewayStore } from './gatewayStore'
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

    it('allows viewers to refresh machine skill readiness without granting machine operations', async () => {
        const store = new MultiUserGatewayStore(':memory:')
        const owner = store.createAccount('owner', 'user', 'owner-namespace', null)
        const viewer = store.createAccount('viewer', 'user', 'viewer-namespace', null)
        store.bindResource({
            resourceType: 'machine',
            resourceId: 'shared-machine',
            ownerAccountId: owner.id,
            coreNamespace: owner.defaultNamespace
        })
        store.grant('machine', 'shared-machine', viewer.id, 'viewer')
        const jwtSecret = new TextEncoder().encode('test-secret-test-secret-test-secret')
        const token = await new SignJWT({ gaid: viewer.id }).setProtectedHeader({ alg: 'HS256' }).sign(jwtSecret)
        const app = new Hono<WebAppEnv>()
        app.use('*', createExecutionMiddleware({ store, jwtSecret }))
        app.post('/api/machines/:id/agent-skills/refresh', c => c.json({ refreshed: true }))
        app.post('/api/machines/:id/spawn', c => c.json({ started: true }))

        app.delete('/api/machines/:id/agent-skills/refresh', c => c.json({ deleted: true }))
        const headers = { authorization: `Bearer ${token}` }
        const refreshResponse = await app.request('/api/machines/shared-machine/agent-skills/refresh', {
            method: 'POST',
            headers
        })
        const spawnResponse = await app.request('/api/machines/shared-machine/spawn', {
            method: 'POST',
            headers
        })

        const deleteResponse = await app.request('/api/machines/shared-machine/agent-skills/refresh', {
            method: 'DELETE',
            headers
        })
        expect(refreshResponse.status).toBe(200)
        expect(await refreshResponse.json()).toEqual({ refreshed: true })
        expect(spawnResponse.status).toBe(403)
        expect(deleteResponse.status).toBe(403)
        store.close()
    })

    it('binds the returned fork session when the caller owns the source session', async () => {
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
        it(`binds the returned ${path} session when the caller owns the source session`, async () => {
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
            getSseManager: () => sseManager
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
