import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { SyncEvent } from '@hapi/protocol/types'
import { authorizeResource } from '../../auth/access'
import { SSEManager } from '../../sse/sseManager'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { VisibilityTracker } from '../../visibility/visibilityTracker'
import type { WebAppEnv } from '../middleware/auth'
import { createMessagesRoutes } from './messages'
import { createGitRoutes } from './git'
import { createPermissionsRoutes } from './permissions'
import { createSessionsRoutes } from './sessions'

function createFixture() {
    const store = new Store(':memory:')
    const owner = store.accounts.create({ username: 'owner', passwordHash: null, role: 'user', defaultNamespace: 'default' })
    const stranger = store.accounts.create({ username: 'stranger', passwordHash: null, role: 'user', defaultNamespace: 'default' })
    const admin = store.accounts.create({ username: 'admin', passwordHash: null, role: 'admin', defaultNamespace: 'default' })
    const stored = store.sessions.getOrCreateSession('owned-session', {}, null, 'default', undefined, undefined, undefined, undefined, owner.id)
    const session = { id: stored.id, namespace: 'default', active: true }
    const engine = {
        resolveSessionAccess: () => ({ ok: true, sessionId: stored.id, session }),
        getMessagesPage: () => ({ messages: [], page: {} }),
        sendMessage: async () => {},
        cancelQueuedMessage: async () => ({ status: 'cancelled' })
    } as unknown as SyncEngine
    return { store, owner, stranger, admin, session, engine }
}

function createMessagesApp(
    fixture: ReturnType<typeof createFixture>,
    identity: { id: number; role: 'admin' | 'user' }
) {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        c.set('accountId', identity.id)
        c.set('role', identity.role)
        await next()
    })
    app.route('/api', createMessagesRoutes(() => fixture.engine, fixture.store))
    app.route('/api', createGitRoutes(() => fixture.engine, fixture.store))
    app.route('/api', createPermissionsRoutes(() => fixture.engine, fixture.store))
    app.route('/api', createSessionsRoutes(() => fixture.engine, () => fixture.store))
    return app
}

describe('multi-user HTTP isolation', () => {
    it('rejects same-namespace strangers while preserving owner, admin, and grant roles', async () => {
        const fixture = createFixture()
        const url = `/api/sessions/${fixture.session.id}/messages`

        expect((await createMessagesApp(fixture, fixture.owner).request(url)).status).toBe(200)
        expect((await createMessagesApp(fixture, fixture.admin).request(url)).status).toBe(200)
        expect((await createMessagesApp(fixture, fixture.stranger).request(url)).status).toBe(403)
        const strangerApp = createMessagesApp(fixture, fixture.stranger)
        expect((await strangerApp.request(`/api/sessions/${fixture.session.id}/git-status`)).status).toBe(403)
        expect((await strangerApp.request(`/api/sessions/${fixture.session.id}/permissions/request-1/approve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}'
        })).status).toBe(403)
        expect((await strangerApp.request(`/api/sessions/${fixture.session.id}/archive`, { method: 'POST' })).status).toBe(403)
        expect((await strangerApp.request(`/api/sessions/${fixture.session.id}/model`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'claude-opus-4' })
        })).status).toBe(403)
        expect((await strangerApp.request(`/api/sessions/${fixture.session.id}/resume-model`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resumeWithSessionModel: true })
        })).status).toBe(403)
        expect((await strangerApp.request(`/api/sessions/${fixture.session.id}`, { method: 'DELETE' })).status).toBe(403)

        fixture.store.grants.upsert({
            resourceType: 'session',
            resourceId: fixture.session.id,
            granteeAccountId: fixture.stranger.id,
            role: 'viewer'
        })
        const viewerApp = createMessagesApp(fixture, fixture.stranger)
        expect((await viewerApp.request(url)).status).toBe(200)
        expect((await viewerApp.request(`/api/sessions/${fixture.session.id}/file`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: '/runtime/demo.txt', content: 'blocked', expectedHash: '0'.repeat(64) })
        })).status).toBe(403)
        expect((await viewerApp.request(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'blocked' })
        })).status).toBe(403)

        fixture.store.grants.upsert({
            resourceType: 'session',
            resourceId: fixture.session.id,
            granteeAccountId: fixture.stranger.id,
            role: 'operator'
        })
        expect((await viewerApp.request(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'allowed' })
        })).status).toBe(200)
    })
})

describe('multi-user SSE isolation', () => {
    it('fans session events out only to owner, grantee, and admin', async () => {
        const fixture = createFixture()
        const grantee = fixture.store.accounts.create({ username: 'grantee', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        fixture.store.grants.upsert({
            resourceType: 'session',
            resourceId: fixture.session.id,
            granteeAccountId: grantee.id,
            role: 'viewer'
        })
        const manager = new SSEManager(0, new VisibilityTracker(), {
            canReadResource: (accountId, namespace, type, id) => authorizeResource({ store: fixture.store, accountId, namespace, resourceType: type, resourceId: id, capability: 'read' }).ok,
            getActiveAccountRole: (accountId) => { const account = fixture.store.accounts.getById(accountId); return account?.disabledAt === null ? account.role : null }
        })
        const subscribe = (accountId: number, role: 'admin' | 'user') => {
            const events: SyncEvent[] = []
            manager.subscribe({
                id: `${role}-${accountId}`,
                namespace: 'default',
                all: true,
                accountId,
                role,
                send: (event) => { events.push(event) },
                sendHeartbeat: () => {}
            })
            return events
        }
        const ownerEvents = subscribe(fixture.owner.id, 'user')
        const strangerEvents = subscribe(fixture.stranger.id, 'user')
        const granteeEvents = subscribe(grantee.id, 'user')
        const adminEvents = subscribe(fixture.admin.id, 'admin')

        manager.broadcast({ type: 'messages-invalidated', namespace: 'default', sessionId: fixture.session.id })
        await Bun.sleep(1)

        expect(ownerEvents).toHaveLength(1)
        expect(granteeEvents).toHaveLength(1)
        expect(adminEvents).toHaveLength(1)
        expect(strangerEvents).toHaveLength(0)
    })
})

describe('account-bound external channels', () => {
    it('persists Telegram bindings and push subscriptions with their account', () => {
        const store = new Store(':memory:')
        const account = store.accounts.create({ username: 'alice', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        expect(store.users.addUser('telegram', '123', 'default', account.id).accountId).toBe(account.id)

        store.push.addPushSubscription('default', {
            endpoint: 'https://push.example/subscription',
            p256dh: 'key',
            auth: 'secret',
            accountId: account.id
        })
        expect(store.push.getPushSubscriptionsByNamespace('default')[0]?.accountId).toBe(account.id)
    })
})
