import { afterEach, describe, expect, it } from 'vitest'
import { MultiUserGatewayStore } from './gatewayStore'
import { createApiToken } from './token'
import { resolveGatewayCliNamespace } from './cliAdapter'

const stores: MultiUserGatewayStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })

describe('gateway CLI adapter', () => {
    it('maps an account token to its isolated core namespace and stops after revocation', () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        const account = store.createAccount('alice', 'user', 'account-alice')
        const generated = createApiToken()
        const token = store.createToken(account.id, 'runner', generated.hash)
        expect(resolveGatewayCliNamespace(store, generated.plaintext)).toBe('account-alice')
        store.revokeToken(token.id, account.id)
        expect(resolveGatewayCliNamespace(store, generated.plaintext)).toBeNull()
    })
})
