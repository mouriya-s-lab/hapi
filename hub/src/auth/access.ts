import type { Store } from '../store'
import type { AccountRole, GrantRole, ResourceType } from '../store/types'

export type AccessLevel = 'none' | 'viewer' | 'operator' | 'owner'

const LEVEL_RANK: Record<AccessLevel, number> = {
    none: 0,
    viewer: 1,
    operator: 2,
    owner: 3
}

/**
 * Compute the access level an account has on a resource, given:
 *   - the account's global role (admin sees everything as owner-equivalent),
 *   - direct ownership (owner_account_id), and
 *   - an explicit resource grant (viewer/operator).
 *
 * `ownerAccountId` may be null for resources created before multi-user that
 * haven't been backfilled yet; in that case only admins have access. (The
 * startup bootstrap backfills these to the admin, so this is a transient
 * state.)
 */
export function resolveAccessLevel(params: {
    store: Store
    accountId: number
    role: AccountRole
    resourceType: ResourceType
    resourceId: string
    ownerAccountId: number | null
}): AccessLevel {
    if (params.role === 'admin') {
        return 'owner'
    }
    if (params.ownerAccountId !== null && params.ownerAccountId === params.accountId) {
        return 'owner'
    }
    const grant = params.store.grants.get(params.resourceType, params.resourceId, params.accountId)
    if (grant) {
        return grant.role === 'operator' ? 'operator' : 'viewer'
    }
    return 'none'
}

/** True when `level` meets or exceeds the access required by `required`. */
export function meetsAccess(level: AccessLevel, required: 'viewer' | 'operator' | 'owner'): boolean {
    return LEVEL_RANK[level] >= LEVEL_RANK[required]
}

export function canRead(level: AccessLevel): boolean {
    return meetsAccess(level, 'viewer')
}

export function canOperate(level: AccessLevel): boolean {
    return meetsAccess(level, 'operator')
}

export function listReadableAccountIds(store: Store, resourceType: ResourceType, resourceId: string): Set<number> {
    const ownerAccountId = resourceType === 'machine'
        ? store.machines.getMachine(resourceId)?.ownerAccountId ?? null
        : store.sessions.getSession(resourceId)?.ownerAccountId ?? null
    const accountIds = new Set<number>()
    if (ownerAccountId !== null) {
        accountIds.add(ownerAccountId)
    }
    for (const grant of store.grants.listForResource(resourceType, resourceId)) {
        accountIds.add(grant.granteeAccountId)
    }
    return accountIds
}

export function listActiveAdminAccountIds(store: Store): number[] {
    return store.accounts.list()
        .filter((account) => account.role === 'admin' && account.disabledAt === null)
        .map((account) => account.id)
}

export type { GrantRole }
