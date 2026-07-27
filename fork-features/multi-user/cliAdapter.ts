import type { MultiUserGatewayStore } from './gatewayStore'
import { parseAccessToken } from '../../hub/src/utils/accessToken'
import { hashApiToken } from './token'

/**
 * 把 CLI 的 bearer token 解析成它所属的 namespace。两种候选哈希按序尝试：
 *
 * 1. **完整串** —— gateway 自己签发的 token 就是这么存哈希的。
 * 2. **剥掉 `:namespace` 后缀的 baseToken** —— 本 fork 的 pre-gateway 体系按
 *    baseToken 存哈希（legacyDbCompat 迁移原样搬入），而 runner 侧配置的
 *    `CLI_API_TOKEN` 允许带 `:<namespace>` 后缀。只按完整串比会让所有带后缀
 *    的历史 runner 在换芯后直接 401。
 *
 * 无论命中哪个，namespace 都取自**服务端 token 记录**——后缀只用于定位 token，
 * 不能自证身份。这条是 pre-gateway 时代就有的安全属性，别退化。
 * base64url 字母表不含 `:`，两种取值空间不重叠，先后顺序不会误判。
 */
export function resolveGatewayCliNamespace(store: MultiUserGatewayStore, plaintextToken: string): string | null {
    const candidates = [plaintextToken]
    const parsed = parseAccessToken(plaintextToken)
    if (parsed && parsed.baseToken !== plaintextToken) candidates.push(parsed.baseToken)

    for (const candidate of candidates) {
        const token = store.getActiveTokenByHash(hashApiToken(candidate))
        if (!token) continue
        const account = store.getAccount(token.accountId)
        if (!account || account.disabledAt !== null) return null
        store.touchTokenLastUsed(token.id)
        return token.namespace
    }
    return null
}
