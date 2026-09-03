import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { afterEach, describe, expect, it } from 'vitest'

import type { WebAppEnv } from '../../hub/src/web/middleware/auth'
import { MultiUserGatewayStore } from './gatewayStore'
import { createPushOwnershipMiddleware } from './pushOwnership'

const stores: MultiUserGatewayStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })

describe('push ownership middleware', () => {
    it('binds and removes successful subscriptions for the authenticated account', async () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        const account = store.createAccount('alice', 'user', 'account-alice')
        const jwtSecret = new TextEncoder().encode('test-secret-test-secret-test-secret')
        const token = await new SignJWT({ uid: 7, ns: 'tenant-blue', gaid: account.id })
            .setProtectedHeader({ alg: 'HS256' })
            .sign(jwtSecret)
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('userId', 7)
            c.set('namespace', 'tenant-blue')
            await next()
        })
        app.use('/push/subscribe', createPushOwnershipMiddleware({ store, jwtSecret }))
        app.post('/push/subscribe', c => c.json({ ok: true }))
        app.delete('/push/subscribe', c => c.json({ ok: true }))
        const request = (method: 'POST' | 'DELETE') => app.fetch(new Request(
            'http://gateway/push/subscribe',
            {
                method,
                headers: {
                    authorization: `Bearer ${token}`,
                    'content-type': 'application/json'
                },
                body: JSON.stringify({ endpoint: 'https://push.test/alice' })
            }
        ))

        expect((await request('POST')).status).toBe(200)
        expect(store.getPushSubscriptionAccount('tenant-blue', 'https://push.test/alice')?.accountId)
            .toBe(account.id)
        expect((await request('DELETE')).status).toBe(200)
        expect(store.getPushSubscriptionAccount('tenant-blue', 'https://push.test/alice')).toBeNull()
    })
})
