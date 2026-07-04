import type { Store } from '../store'
import type { AccountRole, GrantRole, ResourceType } from '../store/types'

export type AccessLevel = 'none' | 'viewer' | 'operator' | 'owner'

const LEVEL_RANK: Record<AccessLevel, number> = {
    none: 0,
    viewer: 1,
    operator: 2,
    owner: 3
}

/** The machine a session runs on, from its stored metadata. */
function sessionMachineId(store: Store, sessionId: string): string | null {
    const meta = store.sessions.getSession(sessionId)?.metadata
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
        const machineId = (meta as Record<string, unknown>).machineId
        if (typeof machineId === 'string' && machineId.length > 0) {
            return machineId
        }
    }
    return null
}

/** True when the account owns `machineId` or holds any grant on it. */
function hasMachineAccess(store: Store, accountId: number, machineId: string): boolean {
    const machine = store.machines.getMachine(machineId)
    if (machine && machine.ownerAccountId !== null && machine.ownerAccountId === accountId) {
        return true
    }
    return store.grants.get('machine', machineId, accountId) !== null
}

/**
 * Compute the access level an account has on a resource, given:
 *   - the account's global role (admin sees everything as owner-equivalent),
 *   - direct ownership (owner_account_id),
 *   - an explicit resource grant (viewer/operator), and
 *   - for sessions: machine-access inheritance — sharing a machine shares
 *     read access to every session running on it. The inherited level is
 *     capped at viewer regardless of the machine grant's role; operating a
 *     session still requires ownership or a session-level grant.
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
    if (params.resourceType === 'session') {
        const machineId = sessionMachineId(params.store, params.resourceId)
        if (machineId !== null && hasMachineAccess(params.store, params.accountId, machineId)) {
            return 'viewer'
        }
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

/**
 * Non-admin account ids that may read a resource: its owner plus every
 * grantee; for sessions also everyone with access to the session's machine
 * (machine-access inheritance, see resolveAccessLevel). Admins are NOT
 * enumerated here — callers that fan events out (SSE, web push) check the
 * admin role separately, or append listActiveAdminAccountIds for channels
 * that have no role attached.
 */
export function listReadableAccountIds(store: Store, resourceType: ResourceType, resourceId: string): Set<number> {
    const ownerAccountId = resourceType === 'machine'
        ? store.machines.getMachine(resourceId)?.ownerAccountId ?? null
        : store.sessions.getSession(resourceId)?.ownerAccountId ?? null
    const ids = new Set<number>()
    if (ownerAccountId !== null) {
        ids.add(ownerAccountId)
    }
    for (const grant of store.grants.listForResource(resourceType, resourceId)) {
        ids.add(grant.granteeAccountId)
    }
    if (resourceType === 'session') {
        const machineId = sessionMachineId(store, resourceId)
        if (machineId !== null) {
            const machineOwner = store.machines.getMachine(machineId)?.ownerAccountId ?? null
            if (machineOwner !== null) {
                ids.add(machineOwner)
            }
            for (const grant of store.grants.listForResource('machine', machineId)) {
                ids.add(grant.granteeAccountId)
            }
        }
    }
    return ids
}

export function listActiveAdminAccountIds(store: Store): number[] {
    return store.accounts.list()
        .filter((a) => a.role === 'admin' && a.disabledAt === null)
        .map((a) => a.id)
}

export type { GrantRole }
