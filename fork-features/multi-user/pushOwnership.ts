import type { MiddlewareHandler } from 'hono'

import type { WebAppEnv } from '../../hub/src/web/middleware/auth'
import { gatewayAccountId } from './executionMount'
import type { MultiUserGatewayStore } from './gatewayStore'

function readEndpoint(value: unknown): string | null {
    if (!value || typeof value !== 'object' || !('endpoint' in value)) return null
    const endpoint = value.endpoint
    return typeof endpoint === 'string' && endpoint.length > 0 ? endpoint : null
}

export function createPushOwnershipMiddleware(deps: {
    store: MultiUserGatewayStore
    jwtSecret: Uint8Array
}): MiddlewareHandler<WebAppEnv> {
    return async function trackPushOwnership(c, next) {
        const method = c.req.method
        if (method !== 'POST' && method !== 'DELETE') {
            await next()
            return
        }

        const body = await c.req.raw.clone().json().catch(() => null)
        const endpoint = readEndpoint(body)
        await next()
        if (!c.res.ok || endpoint === null) return

        const accountId = await gatewayAccountId(c.req.raw, deps.jwtSecret)
        if (accountId === null) return

        const namespace = c.get('namespace')
        if (method === 'POST') {
            deps.store.bindPushSubscriptionAccount({ namespace, endpoint, accountId })
            return
        }
        deps.store.removePushSubscriptionAccount(namespace, endpoint)
    }
}
