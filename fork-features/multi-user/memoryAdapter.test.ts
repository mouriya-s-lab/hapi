import { afterEach, describe, expect, it } from 'bun:test'
import { MultiUserGatewayStore } from './gatewayStore'
import { configureGatewayMemory, decorateMessageForGatewayMemory } from './memoryAdapter'

const stores: MultiUserGatewayStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })

describe('gateway account memory delivery', () => {
    it('decorates only the CLI-bound copy for the sending account', () => {
        const store = new MultiUserGatewayStore(':memory:'); stores.push(store)
        const alice = store.createAccount('alice', 'user', 'alice-ns')
        const bob = store.createAccount('bob', 'user', 'bob-ns')
        store.updateAccount(alice.id, { memory: 'my machine is ALICE-PC' })
        store.updateAccount(bob.id, { memory: 'my machine is BOB-PC' })
        configureGatewayMemory(store)
        const original = { role: 'user', content: { type: 'text', text: 'check my machine' }, meta: { gatewayAccountId: alice.id } }
        const decorated = decorateMessageForGatewayMemory(original) as typeof original
        expect(decorated.content.text).toContain('ALICE-PC')
        expect(decorated.content.text).not.toContain('BOB-PC')
        expect(original.content.text).toBe('check my machine')
    })

    it('leaves messages without an account or memory unchanged', () => {
        const store = new MultiUserGatewayStore(':memory:'); stores.push(store)
        const alice = store.createAccount('alice', 'user', 'alice-ns')
        configureGatewayMemory(store)
        const content = { role: 'user', content: { type: 'text', text: 'hello' }, meta: { gatewayAccountId: alice.id } }
        expect(decorateMessageForGatewayMemory(content)).toBe(content)
    })
})
