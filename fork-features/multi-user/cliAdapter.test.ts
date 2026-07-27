import { afterEach, describe, expect, it } from 'vitest'
import { resolveGatewayCliNamespace } from './cliAdapter'
import { MultiUserGatewayStore } from './gatewayStore'
import { createApiToken, hashApiToken } from './token'

const stores: MultiUserGatewayStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })

describe('gateway CLI adapter', () => {
    it('maps an account token to its isolated core namespace and stops after revocation', () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        const account = store.createAccount('alice', 'user', 'account-alice')
        const generated = createApiToken()
        const token = store.createToken(account.id, 'runner', generated.hash, 'token-runtime')
        expect(resolveGatewayCliNamespace(store, generated.plaintext)).toBe('token-runtime')
        expect(store.getToken(token.id)?.lastUsedAt).not.toBeNull()
        store.revokeToken(token.id, account.id)
        expect(resolveGatewayCliNamespace(store, generated.plaintext)).toBeNull()
    })

    it('接受带 :namespace 后缀的 pre-gateway token —— 哈希按 baseToken 存', () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        const account = store.createAccount('peter', 'user', 'default')
        // pre-gateway 体系按剥掉后缀的 baseToken 存哈希，迁移原样搬了过来
        const baseToken = 'legacy-runner-token'
        store.createToken(account.id, 'homeWin', hashApiToken(baseToken))

        expect(resolveGatewayCliNamespace(store, baseToken)).toBe('default')
        expect(resolveGatewayCliNamespace(store, `${baseToken}:default`)).toBe('default')
        // namespace 取自服务端 token 记录，不是客户端给的后缀
        expect(resolveGatewayCliNamespace(store, `${baseToken}:pretend-admin`)).toBe('default')
    })

    it('后缀不能凭空造出一个有效 token', () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        store.createAccount('peter', 'user', 'default')
        expect(resolveGatewayCliNamespace(store, 'no-such-token:default')).toBeNull()
    })
})
