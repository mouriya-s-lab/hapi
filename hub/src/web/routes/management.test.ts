import { beforeEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { Store } from '../../store'
import { bootstrapMultiUser } from '../../auth/bootstrap'
import { initAuthContext, resetAuthContext } from '../../auth/authContext'
import { createConfiguration } from '../../configuration'
import { createAuthMiddleware, type WebAppEnv } from '../middleware/auth'
import { createAccountRoutes } from './accounts'
import { createGrantRoutes } from './grants'
import { createAuthRoutes } from './auth'
import type { AccountRole } from '../../store/types'

const JWT_SECRET = new TextEncoder().encode('test-secret-key-for-management-routes-0123456789')
const LEGACY_TOKEN = 'mgmt-test-shared-token'

async function makeJwt(accountId: number, role: AccountRole, namespace = 'default'): Promise<string> {
    return await new SignJWT({ uid: accountId, aid: accountId, role, ns: namespace })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(JWT_SECRET)
}

function makeApp(store: Store) {
    const app = new Hono<WebAppEnv>()
    // Public auth route (no middleware).
    app.route('/api', createAuthRoutes(JWT_SECRET, store))
    // Protected routes.
    app.use('/api/*', createAuthMiddleware(JWT_SECRET))
    app.route('/api', createAccountRoutes(store, JWT_SECRET))
    app.route('/api', createGrantRoutes(store))
    return app
}

let store: Store
let adminId: number

beforeEach(async () => {
    const config = await createConfiguration()
    config._setCliApiToken(LEGACY_TOKEN, 'env', false)
    store = new Store(':memory:')
    const boot = bootstrapMultiUser(store, LEGACY_TOKEN)
    adminId = boot.legacyAdminAccountId
    initAuthContext(store, adminId)
})

describe('admin account management', () => {
    it('admin can create, list, and delete accounts', async () => {
        const app = makeApp(store)
        const adminJwt = await makeJwt(adminId, 'admin')

        const createRes = await app.request('/api/admin/accounts', {
            method: 'POST',
            headers: { authorization: `Bearer ${adminJwt}`, 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'alice', password: 'hunter2hunter2', role: 'user' })
        })
        expect(createRes.status).toBe(201)
        const { account } = await createRes.json() as any
        expect(account.username).toBe('alice')
        expect(account.hasPassword).toBe(true)

        const listRes = await app.request('/api/admin/accounts', {
            headers: { authorization: `Bearer ${adminJwt}` }
        })
        const { accounts } = await listRes.json() as any
        expect(accounts.map((a: { username: string }) => a.username).sort()).toEqual(['admin', 'alice'])

        const delRes = await app.request(`/api/admin/accounts/${account.id}`, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${adminJwt}` }
        })
        expect(delRes.status).toBe(200)
    })

    it('non-admin is forbidden from admin routes', async () => {
        const user = store.accounts.create({ username: 'bob', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        const app = makeApp(store)
        const userJwt = await makeJwt(user.id, 'user')
        const res = await app.request('/api/admin/accounts', {
            headers: { authorization: `Bearer ${userJwt}` }
        })
        expect(res.status).toBe(403)
    })

    it('cannot delete or demote the last active admin', async () => {
        const app = makeApp(store)
        const adminJwt = await makeJwt(adminId, 'admin')
        const res = await app.request(`/api/admin/accounts/${adminId}`, {
            method: 'PATCH',
            headers: { authorization: `Bearer ${adminJwt}`, 'content-type': 'application/json' },
            body: JSON.stringify({ role: 'user' })
        })
        expect(res.status).toBe(409)
    })
})

describe('password login', () => {
    it('issues a JWT for valid credentials and rejects bad ones', async () => {
        const app = makeApp(store)
        const adminJwt = await makeJwt(adminId, 'admin')
        await app.request('/api/admin/accounts', {
            method: 'POST',
            headers: { authorization: `Bearer ${adminJwt}`, 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'carol', password: 'correct-password-123', role: 'user' })
        })

        const okRes = await app.request('/api/auth', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'carol', password: 'correct-password-123' })
        })
        expect(okRes.status).toBe(200)
        const body = await okRes.json() as any
        expect(body.token).toBeTruthy()
        expect(body.user.role).toBe('user')

        const badRes = await app.request('/api/auth', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'carol', password: 'wrong' })
        })
        expect(badRes.status).toBe(401)
    })
})

describe('api tokens', () => {
    it('creates a token (plaintext once) and revokes it', async () => {
        const user = store.accounts.create({ username: 'dave', passwordHash: null, role: 'user', defaultNamespace: 'dave-ns' })
        const app = makeApp(store)
        const userJwt = await makeJwt(user.id, 'user', 'dave-ns')

        const createRes = await app.request('/api/tokens', {
            method: 'POST',
            headers: { authorization: `Bearer ${userJwt}`, 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'laptop' })
        })
        expect(createRes.status).toBe(201)
        const { token } = await createRes.json() as any
        expect(token.token).toBeTruthy()
        expect(token.namespace).toBe('dave-ns')

        const listRes = await app.request('/api/tokens', { headers: { authorization: `Bearer ${userJwt}` } })
        const { tokens } = await listRes.json() as any
        expect(tokens).toHaveLength(1)
        // Plaintext is NOT returned on list.
        expect(tokens[0].token).toBeUndefined()

        const delRes = await app.request(`/api/tokens/${token.id}`, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${userJwt}` }
        })
        expect(delRes.status).toBe(200)
        const listAfterRevoke = await app.request('/api/tokens', { headers: { authorization: `Bearer ${userJwt}` } })
        expect((await listAfterRevoke.json() as { tokens: unknown[] }).tokens).toHaveLength(0)
    })
})

describe('resource grants', () => {
    it('owner grants another user access; unrelated user cannot', async () => {
        const owner = store.accounts.create({ username: 'owner', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        const friend = store.accounts.create({ username: 'friend', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        const stranger = store.accounts.create({ username: 'stranger', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        // Owner registers a machine.
        store.machines.getOrCreateMachine('m-owned', { path: '/a', host: 'h' }, null, 'default', owner.id)

        const app = makeApp(store)
        const ownerJwt = await makeJwt(owner.id, 'user')
        const strangerJwt = await makeJwt(stranger.id, 'user')

        // Owner grants friend viewer access.
        const grantRes = await app.request('/api/grants', {
            method: 'POST',
            headers: { authorization: `Bearer ${ownerJwt}`, 'content-type': 'application/json' },
            body: JSON.stringify({ resourceType: 'machine', resourceId: 'm-owned', granteeUsername: 'friend', role: 'viewer' })
        })
        expect(grantRes.status).toBe(201)

        // Stranger cannot administer grants on a machine they don't own.
        const strangerRes = await app.request('/api/grants', {
            method: 'POST',
            headers: { authorization: `Bearer ${strangerJwt}`, 'content-type': 'application/json' },
            body: JSON.stringify({ resourceType: 'machine', resourceId: 'm-owned', granteeUsername: 'stranger', role: 'operator' })
        })
        expect(strangerRes.status).toBe(403)

        // The grant is visible to the owner.
        const listRes = await app.request('/api/grants?resourceType=machine&resourceId=m-owned', {
            headers: { authorization: `Bearer ${ownerJwt}` }
        })
        const { grants } = await listRes.json() as any
        expect(grants).toHaveLength(1)
        expect(grants[0].granteeUsername).toBe('friend')
        expect(friend.id).toBe(grants[0].granteeAccountId)
    })
})
