import type { Store } from '../store'
import type { AccountRole } from '../store/types'
import { constantTimeEquals } from '../utils/crypto'
import { hashApiToken } from '../utils/apiToken'
import { parseAccessToken } from '../utils/accessToken'

/**
 * The identity a raw bearer token resolves to. This is the single source of
 * truth for "who is this request" across the CLI REST API, the socket
 * handshake, the web /api/auth exchange, and Telegram binding.
 */
export type ResolvedAuth = {
    accountId: number
    role: AccountRole
    namespace: string
    /** The api_tokens row id, or null when authenticated via the legacy shared token. */
    tokenId: number | null
}

export type AuthResolverDeps = {
    store: Store
    /** Current legacy shared CLI token (configuration.cliApiToken). */
    getLegacyToken: () => string
    /** Account id the legacy shared token maps to (the bootstrap admin). */
    getLegacyAdminAccountId: () => number | null
}

/**
 * Resolve a raw bearer token (which may carry a `:namespace` suffix) to an
 * authenticated identity.
 *
 * Resolution order:
 *   1. Per-user API token — hash the base part, look it up in api_tokens.
 *      A live (non-revoked) token whose account is enabled wins; the
 *      namespace comes from the token record, NOT from the client-supplied
 *      suffix. This closes the original "namespace is self-asserted" hole.
 *   2. Legacy shared token — constant-time compare against the configured
 *      cliApiToken. Maps to the bootstrap admin and, for backward
 *      compatibility, honours the client-supplied namespace suffix (admins
 *      see every namespace anyway). Keeps existing runners working untouched.
 *
 * Returns null when the token matches nothing or the account is disabled.
 */
export function resolveAuthToken(deps: AuthResolverDeps, rawToken: string): ResolvedAuth | null {
    const parsed = parseAccessToken(rawToken)
    if (!parsed) {
        return null
    }

    // 1. Per-user API token.
    const tokenRow = deps.store.apiTokens.getActiveByHash(hashApiToken(parsed.baseToken))
    if (tokenRow) {
        const account = deps.store.accounts.getById(tokenRow.accountId)
        if (!account || account.disabledAt !== null) {
            return null
        }
        // Best-effort last-used stamp; never block auth on it.
        try {
            deps.store.apiTokens.touchLastUsed(tokenRow.id)
        } catch {
        }
        return {
            accountId: account.id,
            role: account.role,
            namespace: tokenRow.namespace,
            tokenId: tokenRow.id
        }
    }

    // 2. Legacy shared token (backward compatibility).
    const legacyToken = deps.getLegacyToken()
    const legacyAdminId = deps.getLegacyAdminAccountId()
    if (legacyToken && legacyAdminId !== null && constantTimeEquals(parsed.baseToken, legacyToken)) {
        const account = deps.store.accounts.getById(legacyAdminId)
        if (!account || account.disabledAt !== null) {
            return null
        }
        return {
            accountId: account.id,
            role: account.role,
            namespace: parsed.namespace,
            tokenId: null
        }
    }

    return null
}
