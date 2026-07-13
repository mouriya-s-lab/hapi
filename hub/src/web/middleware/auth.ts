import type { MiddlewareHandler } from 'hono'
import { jwtVerify } from 'jose'
import type { Store } from '../../store'
import { resolveActiveWebSession } from '../../auth/webSession'

export type WebAppEnv = {
    Variables: {
        userId: number
        namespace: string
        accountId: number
        role: 'admin' | 'user'
        authSource: 'password' | 'api' | 'legacy' | 'telegram' | 'unknown'
    }
}

export function createAuthMiddleware(jwtSecret: Uint8Array, store: Store): MiddlewareHandler<WebAppEnv> {
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
            const session = resolveActiveWebSession(store, verified.payload)
            if (!session) {
                return c.json({ error: 'Invalid token payload' }, 401)
            }

            c.set('userId', session.userId)
            c.set('namespace', session.namespace)
            c.set('accountId', session.account.id)
            c.set('role', session.account.role)
            c.set('authSource', session.source)
            await next()
            return
        } catch {
            return c.json({ error: 'Invalid token' }, 401)
        }
    }
}
