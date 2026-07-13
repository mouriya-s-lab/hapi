import type { Store } from '../store'
import type { AccountRole, GrantRole, ResourceType, StoredAccount, StoredMachine, StoredSession } from '../store/types'

export type AccessLevel = 'none' | 'viewer' | 'operator' | 'owner'
export type ResourceCapability = 'read' | 'operate' | 'administer'
export type AudienceCapability = 'read' | 'operate'
export type AuthorizedResource = StoredMachine | StoredSession
export type ResourceAuthorization =
    | { ok: true; account: StoredAccount; resource: AuthorizedResource; level: AccessLevel }
    | { ok: false; reason: 'account-unavailable' | 'resource-not-found' | 'namespace-mismatch' | 'insufficient-access' }

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

export function authorizeResource(params: {
    store: Store
    accountId: number
    namespace: string
    resourceType: ResourceType
    resourceId: string
    capability: ResourceCapability
}): ResourceAuthorization {
    const account = params.store.accounts.getById(params.accountId)
    if (!account || account.disabledAt !== null) return { ok: false, reason: 'account-unavailable' }
    const resource = params.resourceType === 'machine'
        ? params.store.machines.getMachine(params.resourceId)
        : params.store.sessions.getSession(params.resourceId)
    if (!resource) return { ok: false, reason: 'resource-not-found' }
    if (resource.namespace !== params.namespace) return { ok: false, reason: 'namespace-mismatch' }
    const level = resolveAccessLevel({
        store: params.store, accountId: account.id, role: account.role,
        resourceType: params.resourceType, resourceId: params.resourceId,
        ownerAccountId: resource.ownerAccountId
    })
    const allowed = params.capability === 'read' ? canRead(level)
        : params.capability === 'operate' ? canOperate(level)
            : level === 'owner'
    return allowed ? { ok: true, account, resource, level } : { ok: false, reason: 'insufficient-access' }
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

export function listOperableAccountIds(store: Store, resourceType: ResourceType, resourceId: string): Set<number> {
    const accountIds = new Set<number>()
    const ownerAccountId = resourceType === 'machine'
        ? store.machines.getMachine(resourceId)?.ownerAccountId ?? null
        : store.sessions.getSession(resourceId)?.ownerAccountId ?? null
    if (ownerAccountId !== null) accountIds.add(ownerAccountId)
    for (const grant of store.grants.listForResource(resourceType, resourceId)) {
        if (grant.role === 'operator') accountIds.add(grant.granteeAccountId)
    }
    return accountIds
}

export function resolveResourceAudience(params: {
    store: Store
    resourceType: ResourceType
    resourceId: string
    capability: AudienceCapability
}): Set<number> {
    const candidates = params.capability === 'read'
        ? listReadableAccountIds(params.store, params.resourceType, params.resourceId)
        : listOperableAccountIds(params.store, params.resourceType, params.resourceId)
    for (const adminId of listActiveAdminAccountIds(params.store)) candidates.add(adminId)
    for (const accountId of candidates) {
        const account = params.store.accounts.getById(accountId)
        if (!account || account.disabledAt !== null) candidates.delete(accountId)
    }
    return candidates
}

export function isSessionRuntimeAccount(store: Store, session: StoredSession, accountId: number): boolean {
    return store.identity.isSessionRuntimeAccount(session.id, accountId)
}

function sessionMachineId(session: StoredSession): string | null {
    if (session.machineId) return session.machineId
    if (!session.metadata || typeof session.metadata !== 'object' || Array.isArray(session.metadata)) return null
    const machineId = (session.metadata as Record<string, unknown>).machineId
    return typeof machineId === 'string' ? machineId : null
}

export function transferSessionOwnership(params: {
    store: Store
    sessionId: string
    requesterAccountId: number
    assignOwner: (sessionId: string, accountId: number) => boolean
}): void {
    params.store.runInTransaction(() => {
        const session = params.store.sessions.getSession(params.sessionId)
        if (!session) throw new Error('Session not found for ownership transfer')
        const daemonAccountId = session.ownerAccountId
        const machineId = sessionMachineId(session)
        if (!params.assignOwner(params.sessionId, params.requesterAccountId)) {
            throw new Error('Failed to transfer session ownership')
        }
        if (daemonAccountId !== null && daemonAccountId !== params.requesterAccountId && machineId) {
            params.store.identity.bindSessionRuntime(params.sessionId, daemonAccountId, machineId)
        }
    })
}

export function listActiveAdminAccountIds(store: Store): number[] {
    return store.accounts.list()
        .filter((account) => account.role === 'admin' && account.disabledAt === null)
        .map((account) => account.id)
}

export type { GrantRole }
