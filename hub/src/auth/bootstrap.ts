import type { Store } from '../store'
import { hashApiToken } from '../utils/apiToken'
import { parseAccessToken } from '../utils/accessToken'

export type BootstrapResult = {
    /** Account id the legacy shared token resolves to. */
    legacyAdminAccountId: number
    /** True when this run created the bootstrap admin (first multi-user start). */
    createdAdmin: boolean
}

const BOOTSTRAP_ADMIN_USERNAME = 'admin'

/**
 * Idempotent multi-user bootstrap, run once at startup after the schema
 * migration. Goals:
 *
 *   - Guarantee exactly one "legacy admin" account that the existing shared
 *     cliApiToken maps to, so all current runners and the web login keep
 *     working with zero reconfiguration.
 *   - Register the shared cliApiToken as that admin's api_tokens row (hashed),
 *     so the normal per-user resolution path handles it too — the legacy
 *     fallback in resolveAuth is then just defense in depth.
 *   - Backfill owner_account_id on every pre-existing machine/session to the
 *     admin, so ownership-scoped queries return the historical data instead of
 *     hiding it.
 *
 * The admin starts with no password (password_hash NULL) — it cannot log in
 * via the web password form until an operator sets one (see /api/admin). It
 * can always authenticate via the shared token in the meantime.
 */
export function bootstrapMultiUser(store: Store, legacyToken: string): BootstrapResult {
    // Find or create the bootstrap admin. Prefer an existing admin account so
    // restarts don't pile up duplicates.
    let adminId: number | null = null
    let createdAdmin = false

    const existingByName = store.accounts.getByUsername(BOOTSTRAP_ADMIN_USERNAME)
    if (existingByName) {
        adminId = existingByName.id
    } else {
        const anyAdmin = store.accounts.list().find((a) => a.role === 'admin')
        if (anyAdmin) {
            adminId = anyAdmin.id
        }
    }

    if (adminId === null) {
        const created = store.accounts.create({
            username: BOOTSTRAP_ADMIN_USERNAME,
            passwordHash: null,
            role: 'admin',
            defaultNamespace: 'default'
        })
        adminId = created.id
        createdAdmin = true
    }

    // Register the shared token as the admin's API token (hashed), if set and
    // not already present. parseAccessToken strips any namespace suffix; the
    // hub's own token must be a bare base token (validateCliApiToken enforces
    // that), so the parse should yield namespace 'default'.
    if (legacyToken) {
        const parsed = parseAccessToken(legacyToken)
        const baseToken = parsed?.baseToken ?? legacyToken
        const tokenHash = hashApiToken(baseToken)
        if (!store.apiTokens.getActiveByHash(tokenHash)) {
            try {
                store.apiTokens.create({
                    accountId: adminId,
                    name: 'Legacy shared token',
                    tokenHash,
                    namespace: 'default'
                })
            } catch {
                // UNIQUE(token_hash) race or pre-existing revoked row — the
                // legacy fallback in resolveAuth still covers this token.
            }
        }
    }

    // Backfill ownership of all pre-existing resources to the admin.
    store.machines.backfillMachineOwners(adminId)
    store.sessions.backfillSessionOwners(adminId)

    return { legacyAdminAccountId: adminId, createdAdmin }
}
