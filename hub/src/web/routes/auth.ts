import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { AuthRequestSchema } from '@hapi/protocol'
import { getConfiguration } from '../../configuration'
import { resolveAuth } from '../../auth/authContext'
import { verifyPassword } from '../../utils/password'
import { validateTelegramInitData } from '../telegramInitData'
import { getOrCreateOwnerId } from '../../config/ownerId'
import type { WebAppEnv } from '../middleware/auth'
import type { Store } from '../../store'
import type { AccountRole } from '../../store/types'

// Web JWTs are short-lived so revoking a token/disabling an account takes
// effect quickly (a still-valid JWT can outlive a revocation by at most this
// window). The web client auto-refreshes before expiry, so a short TTL is
// transparent to users.
const JWT_TTL = '1h'
const LOGIN_FAILURE_LIMIT = 10
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000

type LoginFailure = {
    count: number
    firstAt: number
}

async function signSessionJwt(
    jwtSecret: Uint8Array,
    params: { userId: number; accountId: number; role: AccountRole; namespace: string }
): Promise<string> {
    return await new SignJWT({
        uid: params.userId,
        aid: params.accountId,
        role: params.role,
        ns: params.namespace
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(JWT_TTL)
        .sign(jwtSecret)
}

export function createAuthRoutes(jwtSecret: Uint8Array, store: Store): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const loginFailures = new Map<string, LoginFailure>()

    app.post('/auth', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = AuthRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        // 1. Username + password (multi-user local accounts).
        if ('username' in parsed.data && 'password' in parsed.data) {
            const forwardedFor = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
            const throttleKey = `${forwardedFor}::${parsed.data.username.toLowerCase()}`
            const now = Date.now()
            for (const [key, record] of loginFailures) {
                if (now - record.firstAt >= LOGIN_FAILURE_WINDOW_MS) {
                    loginFailures.delete(key)
                }
            }
            const failure = loginFailures.get(throttleKey)
            if (failure && now - failure.firstAt < LOGIN_FAILURE_WINDOW_MS && failure.count >= LOGIN_FAILURE_LIMIT) {
                return c.json({ error: 'Too many failed attempts. Try again later.' }, 429)
            }
            const account = store.accounts.getByUsername(parsed.data.username)
            // Reject disabled / passwordless (SSO-only or not-yet-set) accounts.
            const ok = account
                && account.disabledAt === null
                && verifyPassword(parsed.data.password, account.passwordHash)
            if (!account || !ok) {
                const current = loginFailures.get(throttleKey)
                if (current) {
                    current.count += 1
                } else {
                    loginFailures.set(throttleKey, { count: 1, firstAt: now })
                }
                return c.json({ error: 'Invalid username or password' }, 401)
            }
            loginFailures.delete(throttleKey)

            const token = await signSessionJwt(jwtSecret, {
                userId: account.id,
                accountId: account.id,
                role: account.role,
                namespace: account.defaultNamespace
            })
            return c.json({
                token,
                user: { id: account.id, username: account.username, role: account.role }
            })
        }

        // 2. Access token (per-user API token or legacy shared token).
        if ('accessToken' in parsed.data) {
            const resolved = resolveAuth(parsed.data.accessToken)
            if (!resolved) {
                return c.json({ error: 'Invalid access token' }, 401)
            }
            const account = store.accounts.getById(resolved.accountId)
            const ownerId = await getOrCreateOwnerId()
            const token = await signSessionJwt(jwtSecret, {
                userId: ownerId,
                accountId: resolved.accountId,
                role: resolved.role,
                namespace: resolved.namespace
            })
            return c.json({
                token,
                user: {
                    id: resolved.accountId,
                    username: account?.username,
                    firstName: account ? undefined : 'Web User',
                    role: resolved.role
                }
            })
        }

        // 3. Telegram initData.
        const configuration = getConfiguration()
        if (!configuration.telegramEnabled || !configuration.telegramBotToken) {
            return c.json({ error: 'Telegram authentication is disabled. Configure TELEGRAM_BOT_TOKEN.' }, 503)
        }

        const result = validateTelegramInitData(parsed.data.initData, configuration.telegramBotToken)
        if (!result.ok) {
            return c.json({ error: result.error }, 401)
        }

        const telegramUserId = String(result.user.id)
        const storedUser = store.users.getUser('telegram', telegramUserId)
        if (!storedUser) {
            return c.json({ error: 'not_bound' }, 401)
        }

        const ownerId = await getOrCreateOwnerId()
        const account = storedUser.accountId === null
            ? store.accounts.list().find((candidate) => candidate.role === 'admin') ?? null
            : store.accounts.getById(storedUser.accountId)
        if (!account || account.disabledAt !== null) {
            return c.json({ error: 'not_bound' }, 401)
        }
        const role: AccountRole = account.role

        const token = await signSessionJwt(jwtSecret, {
            userId: ownerId,
            accountId: account.id,
            role,
            namespace: storedUser.namespace
        })

        return c.json({
            token,
            user: {
                id: ownerId,
                username: result.user.username,
                firstName: result.user.first_name,
                lastName: result.user.last_name,
                role
            }
        })
    })

    return app
}
