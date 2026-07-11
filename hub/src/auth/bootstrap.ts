import type { Store } from '../store'

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
 *   - Keep the shared cliApiToken on the legacy resolver path. It must not be
 *     inserted into api_tokens: a normal token row would shadow the legacy
 *     resolver and discard existing client-supplied namespace suffixes.
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

    // Backfill ownership of all pre-existing resources to the admin.
    store.machines.backfillMachineOwners(adminId)
    store.sessions.backfillSessionOwners(adminId)

    return { legacyAdminAccountId: adminId, createdAdmin }
}
