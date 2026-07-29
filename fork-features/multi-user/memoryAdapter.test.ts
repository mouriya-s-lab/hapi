import { afterEach, describe, expect, it } from 'bun:test'
import { MultiUserGatewayStore } from './gatewayStore'
import { createGatewayMemoryDelivery, stripGatewayMemoryContext } from './memoryAdapter'

const stores: MultiUserGatewayStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })

describe('gateway account memory delivery', () => {
    it('decorates only the CLI-bound copy for the sending account', () => {
        const store = new MultiUserGatewayStore(':memory:'); stores.push(store)
        const alice = store.createAccount('alice', 'user', 'alice-ns')
        const bob = store.createAccount('bob', 'user', 'bob-ns')
        store.updateAccount(alice.id, { memory: 'my machine is ALICE-PC' })
        store.updateAccount(bob.id, { memory: 'my machine is BOB-PC' })
        const delivery = createGatewayMemoryDelivery(store)
        const original = { role: 'user', content: { type: 'text', text: 'check my machine' }, meta: { gatewayAccountId: alice.id } }
        const decorated = delivery.decorateForCli(original) as typeof original
        expect(decorated.content.text).toContain('ALICE-PC')
        expect(decorated.content.text).not.toContain('BOB-PC')
        expect(original.content.text).toBe('check my machine')
    })

    it('leaves messages without an account or memory unchanged', () => {
        const store = new MultiUserGatewayStore(':memory:'); stores.push(store)
        const alice = store.createAccount('alice', 'user', 'alice-ns')
        const delivery = createGatewayMemoryDelivery(store)
        const content = { role: 'user', content: { type: 'text', text: 'hello' }, meta: { gatewayAccountId: alice.id } }
        expect(delivery.decorateForCli(content)).toBe(content)
    })
})

describe('gateway memory context stripping', () => {
    it('removes a complete block and keeps the surrounding prompt', () => {
        const text = '<hapi_user_context user="admin">\nmy machine is VIRCS\n</hapi_user_context>\n\nfix the sidebar'
        expect(stripGatewayMemoryContext(text)).toBe('fix the sidebar')
    })

    it('removes a block truncated mid-way by the CLI title fallback', () => {
        // What the CLI persists: the decorated prompt collapsed to one line and
        // cut at 80 chars, so the closing tag never made it into the title.
        const truncated = '<hapi_user_context user="admin"> This is user-managed context injected by the H…'
        expect(stripGatewayMemoryContext(truncated)).toBe('')
    })

    it('removes an opening tag cut mid-word', () => {
        expect(stripGatewayMemoryContext('real title <hapi_user_cont')).toBe('real title')
    })

    it('leaves ordinary titles untouched', () => {
        expect(stripGatewayMemoryContext('Fix the session list <b> tag')).toBe('Fix the session list <b> tag')
    })
})

describe('gateway memory metadata sanitisation', () => {
    const delivery = () => {
        const store = new MultiUserGatewayStore(':memory:'); stores.push(store)
        return createGatewayMemoryDelivery(store)
    }

    it('drops a summary whose whole text was the injected block', () => {
        const metadata = {
            path: '/work/hapi',
            summary: { text: '<hapi_user_context user="admin"> This is user-managed context injected by the H…', updatedAt: 7 }
        }
        expect(delivery().sanitizeMetadata(metadata)).toEqual({ path: '/work/hapi' })
    })

    it('keeps the real prompt when only part of the title was injected', () => {
        const metadata = {
            summary: { text: '<hapi_user_context user="admin">my machine is VIRCS</hapi_user_context> fix the sidebar', updatedAt: 7 }
        }
        expect(delivery().sanitizeMetadata(metadata)).toEqual({
            summary: { text: 'fix the sidebar', updatedAt: 7 }
        })
    })

    it('strips a leaked block out of a session name', () => {
        const metadata = { name: '<hapi_user_context user="admin">mem</hapi_user_context> Release prep' }
        expect(delivery().sanitizeMetadata(metadata)).toEqual({ name: 'Release prep' })
    })

    it('returns clean metadata by identity', () => {
        const metadata = { name: 'Release prep', summary: { text: 'Release prep', updatedAt: 7 } }
        expect(delivery().sanitizeMetadata(metadata)).toBe(metadata)
    })
})
