import { Hono, type Context } from 'hono'
import { SignJWT } from 'jose'
import {
    CreateAccountRequestSchema,
    CreateApiTokenRequestSchema,
    UpdateAccountRequestSchema,
    UpdateMemoryRequestSchema,
    type AccountSummary,
    type ApiTokenSummary
} from '@hapi/protocol'
import type { WebAppEnv } from '../middleware/auth'
import type { Store } from '../../store'
import type { StoredAccount, StoredApiToken } from '../../store/types'
import { hashPassword } from '../../utils/password'
import { generateApiToken, hashApiToken } from '../../utils/apiToken'

function toAccountSummary(a: StoredAccount): AccountSummary {
    return {
        id: a.id,
        username: a.username,
        role: a.role,
        defaultNamespace: a.defaultNamespace,
        authProvider: a.authProvider,
        hasPassword: a.passwordHash !== null,
        disabled: a.disabledAt !== null,
        createdAt: a.createdAt,
        memory: a.memory
    }
}

function toTokenSummary(t: StoredApiToken): ApiTokenSummary {
    return {
        id: t.id,
        name: t.name,
        namespace: t.namespace,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt
    }
}

/**
 * Account, token, and admin routes. Mounted under /api with the JWT auth
 * middleware already applied, so c.get('accountId'/'role') are populated.
 */
export function createAccountRoutes(store: Store, jwtSecret: Uint8Array): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // --- Sliding-session refresh for password-authenticated web clients ---
    // The web client can't re-submit a password (we never persist it), so it
    // refreshes its short-lived JWT here. Re-validates the account still exists
    // and is enabled, so disabling an account takes effect within one TTL.
    app.post('/auth/refresh', async (c) => {
        const accountId = c.get('accountId')
        const account = store.accounts.getById(accountId)
        if (!account || account.disabledAt !== null) {
            return c.json({ error: 'Account unavailable' }, 401)
        }
        const namespace = c.get('namespace') ?? account.defaultNamespace
        const token = await new SignJWT({ uid: account.id, aid: account.id, role: account.role, ns: namespace })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('1h')
            .sign(jwtSecret)
        return c.json({
            token,
            user: { id: account.id, username: account.username, role: account.role }
        })
    })

    // --- Current user ---
    app.get('/me', (c) => {
        const accountId = c.get('accountId')
        const account = store.accounts.getById(accountId)
        if (!account) {
            // Token-authenticated web users (legacy) may not map to a real
            // account row; synthesize a minimal identity from the JWT claims.
            return c.json({
                user: {
                    id: accountId,
                    role: c.get('role') ?? 'user',
                    username: undefined,
                    defaultNamespace: c.get('namespace')
                }
            })
        }
        return c.json({ user: toAccountSummary(account) })
    })

    // --- Caller's own memory prompt ---
    // Free text the hub prepends to messages this user sends to agents, so
    // the agent resolves user-specific references ("my computer"). Applies
    // from the next message; nothing stored in past messages changes.
    app.patch('/me/memory', async (c) => {
        const accountId = c.get('accountId')
        const account = store.accounts.getById(accountId)
        if (!account) {
            return c.json({ error: 'Account not found' }, 404)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = UpdateMemoryRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        store.accounts.setMemory(accountId, parsed.data.memory)
        return c.json({ user: toAccountSummary(store.accounts.getById(accountId)!) })
    })

    // --- Caller's own API tokens ---
    app.get('/tokens', (c) => {
        const accountId = c.get('accountId')
        const tokens = store.apiTokens.listForAccount(accountId).map(toTokenSummary)
        return c.json({ tokens })
    })

    app.post('/tokens', async (c) => {
        const accountId = c.get('accountId')
        const account = store.accounts.getById(accountId)
        const json = await c.req.json().catch(() => null)
        const parsed = CreateApiTokenRequestSchema.safeParse(json ?? {})
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        // Default the token's namespace to the account's default namespace.
        const namespace = parsed.data.namespace ?? account?.defaultNamespace ?? c.get('namespace') ?? 'default'
        const plaintext = generateApiToken()
        const created = store.apiTokens.create({
            accountId,
            name: parsed.data.name ?? null,
            tokenHash: hashApiToken(plaintext),
            namespace
        })
        // Return the plaintext exactly once; it is never recoverable later.
        const summary: ApiTokenSummary = { ...toTokenSummary(created), token: plaintext }
        return c.json({ token: summary }, 201)
    })

    app.delete('/tokens/:id', (c) => {
        const accountId = c.get('accountId')
        const id = Number(c.req.param('id'))
        if (!Number.isInteger(id)) {
            return c.json({ error: 'Invalid token id' }, 400)
        }
        const ok = store.apiTokens.revoke(id, accountId)
        if (!ok) {
            return c.json({ error: 'Token not found' }, 404)
        }
        return c.json({ ok: true })
    })

    // --- Admin: account management ---
    const requireAdmin = (c: Context<WebAppEnv>): Response | null => {
        if ((c.get('role') ?? 'user') !== 'admin') {
            return c.json({ error: 'Admin access required' }, 403)
        }
        return null
    }

    app.get('/admin/accounts', (c) => {
        const denied = requireAdmin(c)
        if (denied) return denied
        return c.json({ accounts: store.accounts.list().map(toAccountSummary) })
    })

    app.post('/admin/accounts', async (c) => {
        const denied = requireAdmin(c)
        if (denied) return denied
        const json = await c.req.json().catch(() => null)
        const parsed = CreateAccountRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        if (store.accounts.getByUsername(parsed.data.username)) {
            return c.json({ error: 'Username already exists' }, 409)
        }
        const account = store.accounts.create({
            username: parsed.data.username,
            passwordHash: parsed.data.password ? hashPassword(parsed.data.password) : null,
            role: parsed.data.role ?? 'user',
            defaultNamespace: parsed.data.defaultNamespace ?? 'default'
        })
        return c.json({ account: toAccountSummary(account) }, 201)
    })

    app.patch('/admin/accounts/:id', async (c) => {
        const denied = requireAdmin(c)
        if (denied) return denied
        const id = Number(c.req.param('id'))
        if (!Number.isInteger(id)) {
            return c.json({ error: 'Invalid account id' }, 400)
        }
        const target = store.accounts.getById(id)
        if (!target) {
            return c.json({ error: 'Account not found' }, 404)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = UpdateAccountRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        // Guard against locking out the last admin.
        const wouldDemote = parsed.data.role === 'user' && target.role === 'admin'
        const wouldDisable = parsed.data.disabled === true && target.role === 'admin'
        if (wouldDemote || wouldDisable) {
            const activeAdmins = store.accounts.list().filter((a) => a.role === 'admin' && a.disabledAt === null)
            if (activeAdmins.length <= 1) {
                return c.json({ error: 'Cannot demote or disable the last active admin' }, 409)
            }
        }

        if (parsed.data.role) store.accounts.setRole(id, parsed.data.role)
        if (parsed.data.password) store.accounts.setPassword(id, hashPassword(parsed.data.password))
        if (parsed.data.disabled !== undefined) store.accounts.setDisabled(id, parsed.data.disabled)
        if (parsed.data.defaultNamespace) store.accounts.setDefaultNamespace(id, parsed.data.defaultNamespace)
        if (parsed.data.memory !== undefined) store.accounts.setMemory(id, parsed.data.memory)

        return c.json({ account: toAccountSummary(store.accounts.getById(id)!) })
    })

    app.delete('/admin/accounts/:id', (c) => {
        const denied = requireAdmin(c)
        if (denied) return denied
        const id = Number(c.req.param('id'))
        if (!Number.isInteger(id)) {
            return c.json({ error: 'Invalid account id' }, 400)
        }
        const target = store.accounts.getById(id)
        if (!target) {
            return c.json({ error: 'Account not found' }, 404)
        }
        if (target.role === 'admin') {
            const activeAdmins = store.accounts.list().filter((a) => a.role === 'admin' && a.disabledAt === null)
            if (activeAdmins.length <= 1) {
                return c.json({ error: 'Cannot delete the last active admin' }, 409)
            }
        }
        if (id === c.get('accountId')) {
            return c.json({ error: 'Cannot delete your own account' }, 409)
        }
        store.accounts.delete(id)
        return c.json({ ok: true })
    })

    return app
}
