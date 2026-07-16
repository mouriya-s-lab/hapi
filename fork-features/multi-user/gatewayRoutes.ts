import { Hono } from 'hono'
import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'
import type { MultiUserGatewayStore } from './gatewayStore'
import { createApiToken, hashApiToken } from './token'
import { hashPassword, verifyPassword } from './password'
import { ExecutionDispatcher } from './executionDispatcher'

type GatewayEnv = { Variables: { gatewayAccountId: number; gatewayRole: 'admin' | 'user' } }

const loginSchema = z.union([
    z.object({ username: z.string().min(1), password: z.string().min(1) }),
    z.object({ accessToken: z.string().min(1) })
])
const createAccountSchema = z.object({
    username: z.string().trim().min(1).max(64),
    password: z.string().min(8),
    role: z.enum(['admin', 'user']).default('user')
})
const updateAccountSchema = z.object({
    password: z.string().min(8).optional(),
    role: z.enum(['admin', 'user']).optional(),
    disabled: z.boolean().optional()
})
const updateMemorySchema = z.object({ memory: z.string().max(4000).nullable() })
const createTokenSchema = z.object({ name: z.string().trim().max(80).nullable().optional() })
const resourceTypeSchema = z.enum(['session', 'machine'])
const grantSchema = z.object({ accountId: z.number().int().positive(), role: z.enum(['viewer', 'operator']) })

const publicAccount = (account: ReturnType<MultiUserGatewayStore['getAccount']>) => account && ({
    id: account.id,
    username: account.username,
    role: account.role,
    defaultNamespace: account.defaultNamespace,
    disabledAt: account.disabledAt
})

export function createMultiUserGatewayRoutes(deps: {
    store: MultiUserGatewayStore
    jwtSecret: Uint8Array
    coreUserId: number
}): Hono<GatewayEnv> {
    const app = new Hono<GatewayEnv>()
    const dispatcher = new ExecutionDispatcher(deps.store)
    const failures = new Map<string, { count: number; resetAt: number }>()

    app.post('/auth', async (c) => {
        const parsed = loginSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        const failureKey = 'username' in parsed.data
            ? `${c.req.header('x-forwarded-for') ?? 'local'}:${parsed.data.username.toLowerCase()}`
            : null
        const failure = failureKey ? failures.get(failureKey) : null
        if (failure && failure.resetAt > Date.now() && failure.count >= 5) {
            return c.json({ error: 'Too many login attempts' }, 429)
        }
        const tokenRecord = 'accessToken' in parsed.data
            ? deps.store.getActiveTokenByHash(hashApiToken(parsed.data.accessToken))
            : null
        const account = tokenRecord
            ? deps.store.getAccount(tokenRecord.accountId)
            : 'username' in parsed.data ? deps.store.getAccountByUsername(parsed.data.username) : null
        const validPassword = 'username' in parsed.data && account
            ? verifyPassword(parsed.data.password, account.passwordHash)
            : false
        if (!account || account.disabledAt !== null || (!tokenRecord && !validPassword)) {
            if (failureKey) {
                const current = failure && failure.resetAt > Date.now() ? failure : { count: 0, resetAt: Date.now() + 60_000 }
                failures.set(failureKey, { ...current, count: current.count + 1 })
            }
            return c.json({ error: 'Invalid username or password' }, 401)
        }
        if (failureKey) failures.delete(failureKey)
        const token = await new SignJWT({
            uid: deps.coreUserId,
            ns: account.defaultNamespace,
            gaid: account.id,
            role: account.role,
            source: tokenRecord ? 'api' : 'password',
            tid: tokenRecord?.id
        }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('4h').sign(deps.jwtSecret)
        return c.json({ token, user: publicAccount(account) })
    })

    app.post('/auth/refresh', async (c) => {
        const authorization = c.req.header('authorization')
        if (!authorization?.startsWith('Bearer ')) return c.json({ error: 'Missing authorization token' }, 401)
        try {
            const verified = await jwtVerify(authorization.slice(7), deps.jwtSecret, { algorithms: ['HS256'] })
            if (typeof verified.payload.gaid !== 'number') return c.json({ error: 'Invalid token payload' }, 401)
            const account = deps.store.getAccount(verified.payload.gaid)
            if (!account || account.disabledAt !== null) return c.json({ error: 'Invalid token' }, 401)
            if (typeof verified.payload.tid === 'number') {
                const backing = deps.store.getToken(verified.payload.tid)
                if (!backing || backing.revokedAt !== null) return c.json({ error: 'Invalid token' }, 401)
            }
            const token = await new SignJWT({
                uid: deps.coreUserId, ns: account.defaultNamespace, gaid: account.id,
                role: account.role, source: verified.payload.source, tid: verified.payload.tid
            }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('4h').sign(deps.jwtSecret)
            return c.json({ token, user: publicAccount(account) })
        } catch {
            return c.json({ error: 'Invalid token' }, 401)
        }
    })

    app.use('*', async (c, next) => {
        const authorization = c.req.header('authorization')
        const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
        const queryToken = c.req.path.endsWith('/events') ? c.req.query('token') : undefined
        const rawToken = bearerToken ?? queryToken
        if (!rawToken) return c.json({ error: 'Missing authorization token' }, 401)
        try {
            const verified = await jwtVerify(rawToken, deps.jwtSecret, { algorithms: ['HS256'] })
            const accountId = verified.payload.gaid
            if (typeof accountId !== 'number') return c.json({ error: 'Invalid token payload' }, 401)
            const account = deps.store.getAccount(accountId)
            if (!account || account.disabledAt !== null) return c.json({ error: 'Invalid token' }, 401)
            const tokenId = verified.payload.tid
            if (typeof tokenId === 'number') {
                const backingToken = deps.store.getToken(tokenId)
                if (!backingToken || backingToken.revokedAt !== null) return c.json({ error: 'Invalid token' }, 401)
            }
            c.set('gatewayAccountId', account.id)
            c.set('gatewayRole', account.role)
            await next()
            return
        } catch {
            return c.json({ error: 'Invalid token' }, 401)
        }
    })

    app.get('/accounts', (c) => {
        if (c.get('gatewayRole') !== 'admin') return c.json({ error: 'Admin required' }, 403)
        return c.json({ accounts: deps.store.listAccounts().map(publicAccount) })
    })

    app.post('/accounts', async (c) => {
        if (c.get('gatewayRole') !== 'admin') return c.json({ error: 'Admin required' }, 403)
        const parsed = createAccountSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        const account = deps.store.createAccount(
            parsed.data.username,
            parsed.data.role,
            `account-${crypto.randomUUID()}`,
            hashPassword(parsed.data.password)
        )
        return c.json({ account: publicAccount(account) }, 201)
    })

    app.patch('/accounts/:id', async (c) => {
        if (c.get('gatewayRole') !== 'admin') return c.json({ error: 'Admin required' }, 403)
        const parsed = updateAccountSchema.safeParse(await c.req.json().catch(() => null))
        const id = Number(c.req.param('id'))
        if (!parsed.success || !Number.isInteger(id)) return c.json({ error: 'Invalid body' }, 400)
        const account = deps.store.updateAccount(id, {
            role: parsed.data.role,
            disabled: parsed.data.disabled,
            passwordHash: parsed.data.password ? hashPassword(parsed.data.password) : undefined
        })
        return account ? c.json({ account: publicAccount(account) }) : c.json({ error: 'Not found' }, 404)
    })

    app.get('/memory', (c) => {
        const account = deps.store.getAccount(c.get('gatewayAccountId'))!
        return c.json({ memory: account.memory })
    })
    app.patch('/memory', async (c) => {
        const parsed = updateMemorySchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        const account = deps.store.updateAccount(c.get('gatewayAccountId'), { memory: parsed.data.memory })!
        return c.json({ memory: account.memory })
    })

    app.delete('/accounts/:id', (c) => {
        if (c.get('gatewayRole') !== 'admin') return c.json({ error: 'Admin required' }, 403)
        const id = Number(c.req.param('id'))
        if (id === c.get('gatewayAccountId')) return c.json({ error: 'Cannot delete current account' }, 409)
        return deps.store.deleteAccount(id) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404)
    })

    app.get('/tokens', (c) => c.json({ tokens: deps.store.listTokens(c.get('gatewayAccountId')).map(({ tokenHash: _, ...token }) => token) }))
    app.post('/tokens', async (c) => {
        const parsed = createTokenSchema.safeParse(await c.req.json().catch(() => ({})))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        const generated = createApiToken()
        const token = deps.store.createToken(c.get('gatewayAccountId'), parsed.data.name ?? null, generated.hash)
        const { tokenHash: _, ...safeToken } = token
        return c.json({ token: safeToken, plaintext: generated.plaintext }, 201)
    })
    app.delete('/tokens/:id', (c) => {
        const id = Number(c.req.param('id'))
        return deps.store.revokeToken(id, c.get('gatewayAccountId'))
            ? c.json({ ok: true })
            : c.json({ error: 'Not found' }, 404)
    })

    app.get('/grants/:type/:id', (c) => {
        const type = resourceTypeSchema.safeParse(c.req.param('type'))
        if (!type.success) return c.json({ error: 'Invalid resource type' }, 400)
        if (!deps.store.getResource(type.data, c.req.param('id')) && c.get('gatewayRole') === 'admin') {
            const account = deps.store.getAccount(c.get('gatewayAccountId'))!
            deps.store.bindResource({ resourceType: type.data, resourceId: c.req.param('id'), ownerAccountId: account.id, coreNamespace: account.defaultNamespace })
        }
        const decision = dispatcher.authorize({ accountId: c.get('gatewayAccountId'), capability: 'administer', resource: { type: type.data, id: c.req.param('id') } })
        if (decision.kind === 'deny') return c.json({ error: 'Insufficient permissions' }, 403)
        return c.json({ grants: deps.store.listGrants(type.data, c.req.param('id')) })
    })

    app.post('/grants/:type/:id', async (c) => {
        const type = resourceTypeSchema.safeParse(c.req.param('type'))
        const body = grantSchema.safeParse(await c.req.json().catch(() => null))
        if (!type.success || !body.success) return c.json({ error: 'Invalid body' }, 400)
        if (!deps.store.getResource(type.data, c.req.param('id')) && c.get('gatewayRole') === 'admin') {
            const account = deps.store.getAccount(c.get('gatewayAccountId'))!
            deps.store.bindResource({ resourceType: type.data, resourceId: c.req.param('id'), ownerAccountId: account.id, coreNamespace: account.defaultNamespace })
        }
        const decision = dispatcher.authorize({ accountId: c.get('gatewayAccountId'), capability: 'administer', resource: { type: type.data, id: c.req.param('id') } })
        if (decision.kind === 'deny') return c.json({ error: 'Insufficient permissions' }, 403)
        if (!deps.store.getAccount(body.data.accountId)) return c.json({ error: 'Account not found' }, 404)
        deps.store.grant(type.data, c.req.param('id'), body.data.accountId, body.data.role)
        return c.json({ ok: true }, 201)
    })

    app.delete('/grants/:type/:id/:accountId', (c) => {
        const type = resourceTypeSchema.safeParse(c.req.param('type'))
        const grantee = Number(c.req.param('accountId'))
        if (!type.success || !Number.isInteger(grantee)) return c.json({ error: 'Invalid resource' }, 400)
        const decision = dispatcher.authorize({ accountId: c.get('gatewayAccountId'), capability: 'administer', resource: { type: type.data, id: c.req.param('id') } })
        if (decision.kind === 'deny') return c.json({ error: 'Insufficient permissions' }, 403)
        return deps.store.removeGrant(type.data, c.req.param('id'), grantee)
            ? c.json({ ok: true })
            : c.json({ error: 'Not found' }, 404)
    })

    return app
}
