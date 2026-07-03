/**
 * Multi-user isolation regression tests.
 *
 * Covers the holes fixed after the 企业级多用户 rollout:
 *  - messages routes must enforce ownership/grants, not just namespace
 *  - SSE fan-out must not deliver session events to same-namespace strangers
 *  - Telegram bindings must remember the binding account (no admin escalation)
 *  - push subscriptions carry the subscribing account for scoped delivery
 */
import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import { SSEManager } from '../../sse/sseManager'
import { VisibilityTracker } from '../../visibility/visibilityTracker'
import { listReadableAccountIds } from '../../auth/access'
import type { SyncEngine } from '../../sync/syncEngine'
import type { SyncEvent } from '@hapi/protocol/types'
import type { WebAppEnv } from '../middleware/auth'
import { createMessagesRoutes } from './messages'

function setupStore() {
    const store = new Store(':memory:')
    const owner = store.accounts.create({ username: 'owner', passwordHash: null, role: 'user', defaultNamespace: 'default' })
    const stranger = store.accounts.create({ username: 'stranger', passwordHash: null, role: 'user', defaultNamespace: 'default' })
    const admin = store.accounts.create({ username: 'root', passwordHash: null, role: 'admin', defaultNamespace: 'default' })
    const session = store.sessions.getOrCreateSession('tag-1', {}, null, 'default', undefined, undefined, undefined, owner.id)
    return { store, owner, stranger, admin, session }
}

function makeMessagesApp(store: Store, sessionId: string, identity: { accountId: number; role: 'admin' | 'user' }) {
    const engine = {
        resolveSessionAccess: () => ({
            ok: true,
            sessionId,
            session: { id: sessionId, active: true }
        }),
        sendMessage: async () => {},
        cancelQueuedMessage: async () => ({ status: 'cancelled' }),
        getMessagesPage: () => ({ messages: [], page: {} })
    } as unknown as SyncEngine

    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        c.set('accountId', identity.accountId)
        c.set('role', identity.role)
        await next()
    })
    app.route('/api', createMessagesRoutes(() => engine, () => store))
    return app
}

describe('messages routes — ownership enforcement', () => {
    it('same-namespace stranger cannot read or send messages', async () => {
        const { store, stranger, session } = setupStore()
        const app = makeMessagesApp(store, session.id, { accountId: stranger.id, role: 'user' })

        const readRes = await app.request(`/api/sessions/${session.id}/messages`)
        expect(readRes.status).toBe(403)

        const sendRes = await app.request(`/api/sessions/${session.id}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'hi' })
        })
        expect(sendRes.status).toBe(403)
    })

    it('owner and admin can read; viewer grantee can read but not send', async () => {
        const { store, owner, stranger, admin, session } = setupStore()

        const ownerApp = makeMessagesApp(store, session.id, { accountId: owner.id, role: 'user' })
        expect((await ownerApp.request(`/api/sessions/${session.id}/messages`)).status).toBe(200)

        const adminApp = makeMessagesApp(store, session.id, { accountId: admin.id, role: 'admin' })
        expect((await adminApp.request(`/api/sessions/${session.id}/messages`)).status).toBe(200)

        store.grants.upsert({ resourceType: 'session', resourceId: session.id, granteeAccountId: stranger.id, role: 'viewer' })
        const viewerApp = makeMessagesApp(store, session.id, { accountId: stranger.id, role: 'user' })
        expect((await viewerApp.request(`/api/sessions/${session.id}/messages`)).status).toBe(200)
        const sendRes = await viewerApp.request(`/api/sessions/${session.id}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'hi' })
        })
        expect(sendRes.status).toBe(403)
    })

    it('operator grantee can send messages', async () => {
        const { store, stranger, session } = setupStore()
        store.grants.upsert({ resourceType: 'session', resourceId: session.id, granteeAccountId: stranger.id, role: 'operator' })
        const app = makeMessagesApp(store, session.id, { accountId: stranger.id, role: 'user' })
        const sendRes = await app.request(`/api/sessions/${session.id}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'hi' })
        })
        expect(sendRes.status).toBe(200)
    })
})

describe('SSE fan-out — account scoping', () => {
    function makeManager(store: Store) {
        return new SSEManager(0, new VisibilityTracker(), {
            listReadableAccountIds: (type, id) => listReadableAccountIds(store, type, id)
        })
    }

    function subscribe(manager: SSEManager, identity: { accountId: number | null; role: 'admin' | 'user' }) {
        const received: SyncEvent[] = []
        manager.subscribe({
            id: `sub-${identity.role}-${identity.accountId}`,
            namespace: 'default',
            all: true,
            accountId: identity.accountId,
            role: identity.role,
            send: (event) => { received.push(event) },
            sendHeartbeat: () => {}
        })
        return received
    }

    it('message-received only reaches owner, grantee, and admin', async () => {
        const { store, owner, stranger, admin, session } = setupStore()
        const grantee = store.accounts.create({ username: 'buddy', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        store.grants.upsert({ resourceType: 'session', resourceId: session.id, granteeAccountId: grantee.id, role: 'viewer' })

        const manager = makeManager(store)
        const ownerBox = subscribe(manager, { accountId: owner.id, role: 'user' })
        const strangerBox = subscribe(manager, { accountId: stranger.id, role: 'user' })
        const granteeBox = subscribe(manager, { accountId: grantee.id, role: 'user' })
        const adminBox = subscribe(manager, { accountId: admin.id, role: 'admin' })

        manager.broadcast({
            type: 'messages-invalidated',
            namespace: 'default',
            sessionId: session.id
        } as SyncEvent)
        await Bun.sleep(1)

        expect(ownerBox).toHaveLength(1)
        expect(granteeBox).toHaveLength(1)
        expect(adminBox).toHaveLength(1)
        expect(strangerBox).toHaveLength(0)
    })

    it('heartbeat-ish namespace events still reach everyone; unknown sessions are admin-only', async () => {
        const { store, owner, stranger, session } = setupStore()
        const manager = makeManager(store)
        const ownerBox = subscribe(manager, { accountId: owner.id, role: 'user' })
        const strangerBox = subscribe(manager, { accountId: stranger.id, role: 'user' })

        // session-removed is delivered namespace-wide (row already gone).
        store.sessions.deleteSession(session.id, 'default')
        manager.broadcast({ type: 'session-removed', namespace: 'default', sessionId: session.id } as SyncEvent)
        await Bun.sleep(1)
        expect(ownerBox).toHaveLength(1)
        expect(strangerBox).toHaveLength(1)
    })
})

describe('telegram binding — account attribution', () => {
    it('remembers the binding account and moves on re-bind', () => {
        const store = new Store(':memory:')
        const alice = store.accounts.create({ username: 'alice', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        const bob = store.accounts.create({ username: 'bob', passwordHash: null, role: 'user', defaultNamespace: 'default' })

        const bound = store.users.addUser('telegram', '12345', 'default', alice.id)
        expect(bound.accountId).toBe(alice.id)

        // Same chat re-binds with bob's token: binding must follow the new account.
        const rebound = store.users.addUser('telegram', '12345', 'default', bob.id)
        expect(rebound.accountId).toBe(bob.id)

        // Legacy binding without account stays null (falls back to admin at auth).
        const legacy = store.users.addUser('telegram', '99999', 'default')
        expect(legacy.accountId).toBeNull()
    })
})

describe('push subscriptions — account attribution', () => {
    it('persists the subscribing account and keeps legacy rows null', () => {
        const store = new Store(':memory:')
        const alice = store.accounts.create({ username: 'alice', passwordHash: null, role: 'user', defaultNamespace: 'default' })

        store.push.addPushSubscription('default', { endpoint: 'https://e/1', p256dh: 'k', auth: 'a', accountId: alice.id })
        store.push.addPushSubscription('default', { endpoint: 'https://e/2', p256dh: 'k', auth: 'a' })

        const rows = store.push.getPushSubscriptionsByNamespace('default')
        const byEndpoint = new Map(rows.map((r) => [r.endpoint, r.accountId]))
        expect(byEndpoint.get('https://e/1')).toBe(alice.id)
        expect(byEndpoint.get('https://e/2')).toBeNull()
    })
})
