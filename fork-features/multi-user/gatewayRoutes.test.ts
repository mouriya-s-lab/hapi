import { afterEach, describe, expect, it } from 'vitest'
import { MultiUserGatewayStore } from './gatewayStore'
import { createMultiUserGatewayRoutes } from './gatewayRoutes'
import { hashPassword } from './password'
import { Hono } from 'hono'

const stores: MultiUserGatewayStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })

const jsonRequest = (path: string, body?: unknown, token?: string, method = 'POST') => new Request(`http://gateway${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
})

describe('multi-user gateway routes', () => {
    it('supports password login and admin account creation without core account tables', async () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        store.createAccount('admin', 'admin', 'admin-ns', hashPassword('password-123'))
        const app = createMultiUserGatewayRoutes({ store, jwtSecret: new TextEncoder().encode('x'.repeat(32)), coreUserId: 7 })

        const login = await app.fetch(jsonRequest('/auth', { username: 'admin', password: 'password-123' }))
        expect(login.status).toBe(200)
        const { token } = await login.json() as { token: string }
        const created = await app.fetch(jsonRequest('/accounts', { username: 'alice', password: 'password-456', role: 'user' }, token))
        expect(created.status).toBe(201)
        expect(store.getAccountByUsername('alice')).toMatchObject({ username: 'alice', role: 'user' })
    })

    it('shows API token plaintext once and rejects its JWT after revocation', async () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        store.createAccount('admin', 'admin', 'admin-ns', hashPassword('password-123'))
        const app = createMultiUserGatewayRoutes({ store, jwtSecret: new TextEncoder().encode('x'.repeat(32)), coreUserId: 7 })
        const passwordLogin = await app.fetch(jsonRequest('/auth', { username: 'admin', password: 'password-123' }))
        const passwordJwt = (await passwordLogin.json() as { token: string }).token
        const created = await app.fetch(jsonRequest('/tokens', { name: 'phone' }, passwordJwt))
        const result = await created.json() as { plaintext: string; token: { id: number } }
        expect(result.plaintext.startsWith('hapi_mu_')).toBe(true)

        const apiLogin = await app.fetch(jsonRequest('/auth', { accessToken: result.plaintext }))
        const apiJwt = (await apiLogin.json() as { token: string }).token
        expect((await app.fetch(new Request('http://gateway/tokens', { headers: { authorization: `Bearer ${apiJwt}` } }))).status).toBe(200)
        expect((await app.fetch(jsonRequest(`/tokens/${result.token.id}`, undefined, passwordJwt, 'DELETE'))).status).toBe(200)
        expect((await app.fetch(new Request('http://gateway/tokens', { headers: { authorization: `Bearer ${apiJwt}` } }))).status).toBe(401)
    })

    it('keeps account memory private and isolated per authenticated account', async () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        store.createAccount('alice', 'user', 'alice-ns', hashPassword('password-123'))
        store.createAccount('bob', 'user', 'bob-ns', hashPassword('password-456'))
        const app = createMultiUserGatewayRoutes({ store, jwtSecret: new TextEncoder().encode('x'.repeat(32)), coreUserId: 7 })
        const aliceJwt = (await (await app.fetch(jsonRequest('/auth', { username: 'alice', password: 'password-123' }))).json() as { token: string }).token
        const bobJwt = (await (await app.fetch(jsonRequest('/auth', { username: 'bob', password: 'password-456' }))).json() as { token: string }).token

        expect((await app.fetch(jsonRequest('/memory', { memory: 'ALICE-ONLY' }, aliceJwt, 'PATCH'))).status).toBe(200)
        expect((await app.fetch(jsonRequest('/memory', { memory: 'BOB-ONLY' }, bobJwt, 'PATCH'))).status).toBe(200)
        expect(await (await app.fetch(new Request('http://gateway/memory', { headers: { authorization: `Bearer ${aliceJwt}` } }))).json()).toEqual({ memory: 'ALICE-ONLY' })
        expect(await (await app.fetch(new Request('http://gateway/memory', { headers: { authorization: `Bearer ${bobJwt}` } }))).json()).toEqual({ memory: 'BOB-ONLY' })
        expect(await (await app.fetch(new Request('http://gateway/accounts', { headers: { authorization: `Bearer ${aliceJwt}` } }))).json()).toEqual({ error: 'Admin required' })
    })

    it('lets an administrator edit the selected account memory without changing another account', async () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        store.createAccount('admin', 'admin', 'admin-ns', hashPassword('password-123'))
        const alice = store.createAccount('alice', 'user', 'alice-ns', hashPassword('password-456'))
        const bob = store.createAccount('bob', 'user', 'bob-ns', hashPassword('password-789'))
        const app = createMultiUserGatewayRoutes({ store, jwtSecret: new TextEncoder().encode('x'.repeat(32)), coreUserId: 7 })
        const adminJwt = (await (await app.fetch(jsonRequest('/auth', { username: 'admin', password: 'password-123' }))).json() as { token: string }).token
        const aliceJwt = (await (await app.fetch(jsonRequest('/auth', { username: 'alice', password: 'password-456' }))).json() as { token: string }).token

        expect((await app.fetch(jsonRequest(`/accounts/${bob.id}`, { memory: 'BOB-MANAGED' }, aliceJwt, 'PATCH'))).status).toBe(403)
        expect((await app.fetch(jsonRequest(`/accounts/${bob.id}`, { memory: 'BOB-MANAGED' }, adminJwt, 'PATCH'))).status).toBe(200)
        expect(store.getAccount(bob.id)?.memory).toBe('BOB-MANAGED')
        expect(store.getAccount(alice.id)?.memory).toBeNull()
    })

    it('lets only an owner administer machine grants', async () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        const owner = store.createAccount('owner', 'user', 'owner-ns', hashPassword('password-123'))
        const viewer = store.createAccount('viewer', 'user', 'viewer-ns', hashPassword('password-456'))
        store.bindResource({ resourceType: 'machine', resourceId: 'm1', ownerAccountId: owner.id, coreNamespace: 'runtime' })
        const app = createMultiUserGatewayRoutes({ store, jwtSecret: new TextEncoder().encode('x'.repeat(32)), coreUserId: 7 })
        const ownerLogin = await app.fetch(jsonRequest('/auth', { username: 'owner', password: 'password-123' }))
        const viewerLogin = await app.fetch(jsonRequest('/auth', { username: 'viewer', password: 'password-456' }))
        const ownerJwt = (await ownerLogin.json() as { token: string }).token
        const viewerJwt = (await viewerLogin.json() as { token: string }).token

        expect((await app.fetch(jsonRequest('/grants/machine/m1', { accountId: viewer.id, role: 'viewer' }, ownerJwt))).status).toBe(201)
        expect((await app.fetch(new Request('http://gateway/grants/machine/m1', { headers: { authorization: `Bearer ${viewerJwt}` } }))).status).toBe(403)
    })

    it('accepts the browser SSE query-token transport', async () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        store.createAccount('admin', 'admin', 'admin-ns', hashPassword('password-123'))
        const routes = createMultiUserGatewayRoutes({ store, jwtSecret: new TextEncoder().encode('x'.repeat(32)), coreUserId: 7 })
        const app = new Hono()
        app.route('/api', routes)
        app.get('/api/events', c => c.json({ ok: true }))
        const login = await app.fetch(jsonRequest('/api/auth', { username: 'admin', password: 'password-123' }))
        const token = (await login.json() as { token: string }).token
        expect((await app.fetch(new Request(`http://gateway/api/events?token=${encodeURIComponent(token)}`))).status).toBe(200)
    })

    it('rate limits repeated password failures', async () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        store.createAccount('admin', 'admin', 'admin-ns', hashPassword('password-123'))
        const app = createMultiUserGatewayRoutes({ store, jwtSecret: new TextEncoder().encode('x'.repeat(32)), coreUserId: 7 })
        for (let attempt = 0; attempt < 5; attempt++) {
            expect((await app.fetch(jsonRequest('/auth', { username: 'admin', password: 'wrong-password' }))).status).toBe(401)
        }
        expect((await app.fetch(jsonRequest('/auth', { username: 'admin', password: 'password-123' }))).status).toBe(429)
    })
})
