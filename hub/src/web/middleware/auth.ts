import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { jwtVerify } from 'jose'

export type WebAppEnv = {
    Variables: {
        userId: number
        namespace: string
        accountId: number
        role: 'admin' | 'user'
        authSource: 'password' | 'api' | 'legacy' | 'telegram' | 'unknown'
    }
}

const jwtPayloadSchema = z.object({
    uid: z.number(),
    ns: z.string(),
    aid: z.number().optional(),
    role: z.enum(['admin', 'user']).optional(),
    src: z.enum(['password', 'api', 'legacy', 'telegram']).optional()
})

export function createAuthMiddleware(jwtSecret: Uint8Array): MiddlewareHandler<WebAppEnv> {
    return async (c, next) => {
        const path = c.req.path
        if (path === '/api/auth' || path === '/api/bind') {
            await next()
            return
        }

        const authorization = c.req.header('authorization')
        const tokenFromHeader = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
        const tokenFromQuery = path === '/api/events' ? c.req.query().token : undefined
        const token = tokenFromHeader ?? tokenFromQuery

        if (!token) {
            return c.json({ error: 'Missing authorization token' }, 401)
        }

        try {
            const verified = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] })
            const parsed = jwtPayloadSchema.safeParse(verified.payload)
            if (!parsed.success) {
                return c.json({ error: 'Invalid token payload' }, 401)
            }

            c.set('userId', parsed.data.uid)
            c.set('namespace', parsed.data.ns)
            // aid/role are present on tokens issued after the multi-user
            // upgrade. Legacy tokens (pre-upgrade, still within their 4h TTL)
            // lack them; fall back to uid as the account id and the least
            // privileged role so an old token can't silently act as admin.
            c.set('accountId', parsed.data.aid ?? parsed.data.uid)
            c.set('role', parsed.data.role ?? 'user')
            c.set('authSource', parsed.data.src ?? 'unknown')
            await next()
            return
        } catch {
            return c.json({ error: 'Invalid token' }, 401)
        }
    }
}
