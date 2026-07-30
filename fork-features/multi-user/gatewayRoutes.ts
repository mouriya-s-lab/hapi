import { Hono } from 'hono'
import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'

import type { Account } from './domain'
import { ExecutionDispatcher } from './executionDispatcher'
import type { MultiUserGatewayStore } from './gatewayStore'
import { hashPassword, verifyPassword } from './password'
import { createApiToken, hashApiToken } from './token'

type GatewayEnv = { Variables: { gatewayAccountId: number; gatewayRole: 'admin' | 'user' } }
type PublicAccount = Pick<
    Account,
    'id' | 'username' | 'role' | 'defaultNamespace' | 'disabledAt' | 'memory'
>

export type TelegramGatewayIdentity = {
    platformUserId: string
    namespace: string
    username?: string
    firstName?: string
    lastName?: string
}

export type TelegramGatewayResult =
    | { kind: 'authenticated'; identity: TelegramGatewayIdentity }
    | { kind: 'rejected'; status: 401 | 409 | 503; error: string }

export type TelegramGatewayAdapter = {
    authenticate(initData: string): Promise<TelegramGatewayResult>
    bind(initData: string, namespace: string): Promise<TelegramGatewayResult>
}

const loginSchema = z.union([
    z.object({ username: z.string().min(1), password: z.string().min(1) }),
    z.object({ accessToken: z.string().min(1) }),
    z.object({ initData: z.string().min(1) })
])
const bindSchema = z.object({
    initData: z.string().min(1),
    accessToken: z.string().min(1)
})
const createAccountSchema = z.object({
    username: z.string().trim().min(1).max(64),
    password: z.string().min(8),
    role: z.enum(['admin', 'user']).default('user')
})
const updateAccountSchema = z.object({
    password: z.string().min(8).optional(),
    role: z.enum(['admin', 'user']).optional(),
    disabled: z.boolean().optional(),
    memory: z.string().max(4000).nullable().optional()
})
const updateMemorySchema = z.object({ memory: z.string().max(4000).nullable() })
const createTokenSchema = z.object({ name: z.string().trim().max(80).nullable().optional() })
const resourceTypeSchema = z.enum(['session', 'machine'])
const grantSchema = z.object({ accountId: z.number().int().positive(), role: z.enum(['viewer', 'operator']) })

function publicAccount(account: Account | null): PublicAccount | null {
    if (!account) return null
    return {
        id: account.id,
        username: account.username,
        role: account.role,
        defaultNamespace: account.defaultNamespace,
        disabledAt: account.disabledAt,
        memory: account.memory
    }
}

function publicTelegramAccount(account: Account, identity: TelegramGatewayIdentity) {
    return {
        ...publicAccount(account),
        username: identity.username ?? account.username,
        firstName: identity.firstName,
        lastName: identity.lastName
    }
}

async function issueGatewayToken(params: {
    account: Account
    namespace: string
    source: 'api' | 'password' | 'telegram'
    coreUserId: number
    jwtSecret: Uint8Array
    apiTokenId?: number
    telegramPlatformUserId?: string
}): Promise<string> {
    return new SignJWT({
        uid: params.coreUserId,
        ns: params.namespace,
        gaid: params.account.id,
        role: params.account.role,
        source: params.source,
        tid: params.apiTokenId,
        tgid: params.telegramPlatformUserId
    }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('4h').sign(params.jwtSecret)
}

export function createMultiUserGatewayRoutes(deps: {
    store: MultiUserGatewayStore
    jwtSecret: Uint8Array
    coreUserId: number
    telegram?: TelegramGatewayAdapter
}): Hono<GatewayEnv> {
    const app = new Hono<GatewayEnv>()
    const dispatcher = new ExecutionDispatcher(deps.store)
    const failures = new Map<string, { count: number; resetAt: number }>()

    app.post('/auth', async (c) => {
        const parsed = loginSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)

        if ('initData' in parsed.data) {
            if (!deps.telegram) {
                return c.json({ error: 'Telegram authentication is disabled. Configure TELEGRAM_BOT_TOKEN.' }, 503)
            }
            const result = await deps.telegram.authenticate(parsed.data.initData)
            if (result.kind === 'rejected') return c.json({ error: result.error }, result.status)
            const existingBinding = deps.store.getExternalIdentity(
                'telegram',
                result.identity.platformUserId
            )
            const account = existingBinding
                ? deps.store.getAccount(existingBinding.accountId)
                : deps.store.resolveUniqueActiveAccountByNamespace(result.identity.namespace)
            if (!account || account.disabledAt !== null) return c.json({ error: 'not_bound' }, 401)
            if (!existingBinding) {
                deps.store.bindExternalIdentity({
                    platform: 'telegram',
                    platformUserId: result.identity.platformUserId,
                    accountId: account.id
                })
            }
            const token = await issueGatewayToken({
                account,
                namespace: result.identity.namespace,
                source: 'telegram',
                coreUserId: deps.coreUserId,
                jwtSecret: deps.jwtSecret,
                telegramPlatformUserId: result.identity.platformUserId
            })
            return c.json({ token, user: publicTelegramAccount(account, result.identity) })
        }

        const failureKey = 'username' in parsed.data
            ? `${c.req.header('x-forwarded-for') ?? 'local'}:${parsed.data.username.toLowerCase()}`
            : null
        const failure = failureKey ? failures.get(failureKey) : null
        if (failure && failure.resetAt > Date.now() && failure.count >= 5) {
            return c.json({ error: 'Too many login attempts' }, 429)
        }
        const apiToken = 'accessToken' in parsed.data
            ? deps.store.getActiveTokenByHash(hashApiToken(parsed.data.accessToken))
            : null
        let account: Account | null
        if (apiToken) {
            account = deps.store.getAccount(apiToken.accountId)
        } else if ('username' in parsed.data) {
            account = deps.store.getAccountByUsername(parsed.data.username)
        } else {
            account = null
        }
        const validPassword = 'username' in parsed.data && account
            ? verifyPassword(parsed.data.password, account.passwordHash)
            : false
        if (!account || account.disabledAt !== null || (!apiToken && !validPassword)) {
            if (failureKey) {
                const current = failure && failure.resetAt > Date.now()
                    ? failure
                    : { count: 0, resetAt: Date.now() + 60_000 }
                failures.set(failureKey, { ...current, count: current.count + 1 })
            }
            return c.json({ error: 'Invalid username or password' }, 401)
        }
        if (failureKey) failures.delete(failureKey)
        if (apiToken) deps.store.touchTokenLastUsed(apiToken.id)
        const token = await issueGatewayToken({
            account,
            namespace: apiToken?.namespace ?? account.defaultNamespace,
            source: apiToken ? 'api' : 'password',
            coreUserId: deps.coreUserId,
            jwtSecret: deps.jwtSecret,
            apiTokenId: apiToken?.id
        })
        return c.json({ token, user: publicAccount(account) })
    })

    app.post('/bind', async (c) => {
        const parsed = bindSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        if (!deps.telegram) {
            return c.json({ error: 'Telegram authentication is disabled. Configure TELEGRAM_BOT_TOKEN.' }, 503)
        }
        const apiToken = deps.store.getActiveTokenByHash(hashApiToken(parsed.data.accessToken))
        const account = apiToken ? deps.store.getAccount(apiToken.accountId) : null
        if (!apiToken || !account || account.disabledAt !== null) {
            return c.json({ error: 'Invalid access token' }, 401)
        }
        const result = await deps.telegram.bind(parsed.data.initData, apiToken.namespace)
        if (result.kind === 'rejected') return c.json({ error: result.error }, result.status)
        deps.store.bindExternalIdentity({
            platform: 'telegram',
            platformUserId: result.identity.platformUserId,
            accountId: account.id
        })
        deps.store.touchTokenLastUsed(apiToken.id)
        const token = await issueGatewayToken({
            account,
            namespace: apiToken.namespace,
            source: 'telegram',
            coreUserId: deps.coreUserId,
            jwtSecret: deps.jwtSecret,
            telegramPlatformUserId: result.identity.platformUserId
        })
        return c.json({ token, user: publicTelegramAccount(account, result.identity) })
    })

    app.post('/auth/refresh', async (c) => {
        const authorization = c.req.header('authorization')
        if (!authorization?.startsWith('Bearer ')) return c.json({ error: 'Missing authorization token' }, 401)
        try {
            const verified = await jwtVerify(authorization.slice(7), deps.jwtSecret, { algorithms: ['HS256'] })
            if (typeof verified.payload.gaid !== 'number') return c.json({ error: 'Invalid token payload' }, 401)
            const account = deps.store.getAccount(verified.payload.gaid)
            if (!account || account.disabledAt !== null) return c.json({ error: 'Invalid token' }, 401)
            const apiToken = typeof verified.payload.tid === 'number'
                ? deps.store.getToken(verified.payload.tid)
                : null
            if (typeof verified.payload.tid === 'number' && (!apiToken || apiToken.revokedAt !== null)) {
                return c.json({ error: 'Invalid token' }, 401)
            }
            const source = verified.payload.source === 'telegram'
                ? 'telegram'
                : apiToken ? 'api' : 'password'
            const telegramPlatformUserId = source === 'telegram'
                && typeof verified.payload.tgid === 'string'
                ? verified.payload.tgid
                : undefined
            if (source === 'telegram') {
                const binding = telegramPlatformUserId
                    ? deps.store.getExternalIdentity('telegram', telegramPlatformUserId)
                    : null
                if (!binding || binding.accountId !== account.id) {
                    return c.json({ error: 'Invalid token' }, 401)
                }
            }
            const namespace = source === 'telegram' && typeof verified.payload.ns === 'string'
                ? verified.payload.ns
                : apiToken?.namespace ?? account.defaultNamespace
            const token = await issueGatewayToken({
                account,
                namespace,
                source,
                coreUserId: deps.coreUserId,
                jwtSecret: deps.jwtSecret,
                apiTokenId: apiToken?.id,
                telegramPlatformUserId
            })
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
                const apiToken = deps.store.getToken(tokenId)
                if (!apiToken || apiToken.revokedAt !== null) return c.json({ error: 'Invalid token' }, 401)
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
            passwordHash: parsed.data.password ? hashPassword(parsed.data.password) : undefined,
            memory: parsed.data.memory
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
