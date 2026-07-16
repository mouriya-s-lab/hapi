import type { MultiUserGatewayStore } from './gatewayStore'
import { hashApiToken } from './token'

export function resolveGatewayCliNamespace(store: MultiUserGatewayStore, plaintextToken: string): string | null {
    const token = store.getActiveTokenByHash(hashApiToken(plaintextToken))
    if (!token) return null
    const account = store.getAccount(token.accountId)
    return account && account.disabledAt === null ? account.defaultNamespace : null
}
