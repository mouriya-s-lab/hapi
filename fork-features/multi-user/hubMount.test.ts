import { createHmac } from 'node:crypto'

import { afterEach, describe, expect, it } from 'vitest'

import { Store } from '../../hub/src/store'
import { createTelegramGatewayAdapter } from './hubMount'

const stores: Store[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })

function createTelegramInitData(botToken: string, userId: number): string {
    const params = new URLSearchParams({
        auth_date: String(Math.floor(Date.now() / 1000)),
        query_id: 'fixture-query',
        user: JSON.stringify({ id: userId, first_name: 'Alice', username: 'alice_tg' })
    })
    const dataCheckString = Array.from(params.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
    params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'))
    return params.toString()
}

describe('Telegram gateway adapter', () => {
    it('validates signed initData, binds a core namespace, and rejects cross-namespace rebinding', async () => {
        const store = new Store(':memory:')
        stores.push(store)
        const botToken = '123456:test-bot-token'
        const initData = createTelegramInitData(botToken, 42)
        const adapter = createTelegramGatewayAdapter(store, botToken)

        expect(await adapter.authenticate(initData)).toMatchObject({
            kind: 'rejected',
            status: 401,
            error: 'not_bound'
        })
        expect(await adapter.bind(initData, 'tenant-blue')).toMatchObject({
            kind: 'authenticated',
            identity: { platformUserId: '42', namespace: 'tenant-blue' }
        })
        expect(store.users.getUser('telegram', '42')?.namespace).toBe('tenant-blue')
        expect(await adapter.authenticate(initData)).toMatchObject({
            kind: 'authenticated',
            identity: { platformUserId: '42', namespace: 'tenant-blue' }
        })
        expect(await adapter.bind(initData, 'tenant-red')).toMatchObject({
            kind: 'rejected',
            status: 409,
            error: 'already_bound'
        })
    })
})
