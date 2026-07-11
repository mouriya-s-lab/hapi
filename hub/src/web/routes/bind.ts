import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { z } from 'zod'
import { getConfiguration } from '../../configuration'
import { resolveAuth } from '../../auth/authContext'
import { validateTelegramInitData } from '../telegramInitData'
import { getOrCreateOwnerId } from '../../config/ownerId'
import type { WebAppEnv } from '../middleware/auth'
import type { Store } from '../../store'

const bindBodySchema = z.object({
    initData: z.string(),
    accessToken: z.string()
})

export function createBindRoutes(jwtSecret: Uint8Array, store: Store): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.post('/bind', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = bindBodySchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const configuration = getConfiguration()
        const resolved = resolveAuth(parsed.data.accessToken)
        if (!resolved) {
            return c.json({ error: 'Invalid access token' }, 401)
        }
        const namespace = resolved.namespace

        if (!configuration.telegramEnabled || !configuration.telegramBotToken) {
            return c.json({ error: 'Telegram authentication is disabled. Configure TELEGRAM_BOT_TOKEN.' }, 503)
        }

        const result = validateTelegramInitData(parsed.data.initData, configuration.telegramBotToken)
        if (!result.ok) {
            return c.json({ error: result.error }, 401)
        }

        const telegramUserId = String(result.user.id)
        const existingUser = store.users.getUser('telegram', telegramUserId)
        if (existingUser && existingUser.namespace !== namespace) {
            return c.json({ error: 'already_bound' }, 409)
        }
        store.users.addUser('telegram', telegramUserId, namespace, resolved.accountId)

        const userId = await getOrCreateOwnerId()

        const token = await new SignJWT({ uid: userId, aid: resolved.accountId, role: resolved.role, ns: namespace })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('1h')
            .sign(jwtSecret)

        return c.json({
            token,
            user: {
                id: userId,
                username: result.user.username,
                firstName: result.user.first_name,
                lastName: result.user.last_name,
                role: resolved.role
            }
        })
    })

    return app
}
