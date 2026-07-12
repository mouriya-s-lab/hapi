import type { Store } from '../store'
import { getConfiguration } from '../configuration'
import { type AuthResolverDeps, type ResolvedAuth, resolveAuthToken } from './resolveAuth'

/**
 * Process-wide auth context. startHub initializes this once after the schema
 * migration + bootstrap so the four token entry points (CLI REST, socket
 * handshake, web /api/auth, Telegram bind) share one resolution path without
 * threading the legacy-admin id through every constructor.
 */
let deps: AuthResolverDeps | null = null

export function initAuthContext(store: Store, legacyAdminAccountId: number): void {
    deps = {
        store,
        getLegacyToken: () => getConfiguration().cliApiToken,
        getLegacyAdminAccountId: () => legacyAdminAccountId
    }
}

export function isAuthContextReady(): boolean {
    return deps !== null
}

export function getLegacyAdminAccountId(): number | null {
    return deps?.getLegacyAdminAccountId() ?? null
}

/**
 * Resolve a raw bearer token to an identity, or null. Returns null if the auth
 * context hasn't been initialized yet (startup ordering guard).
 */
export function resolveAuth(rawToken: string): ResolvedAuth | null {
    if (!deps) {
        return null
    }
    return resolveAuthToken(deps, rawToken)
}

/** Test/teardown helper. */
export function resetAuthContext(): void {
    deps = null
}
