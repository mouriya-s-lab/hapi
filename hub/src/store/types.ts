export type StoredSession = {
    id: string
    tag: string | null
    namespace: string
    machineId: string | null
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    agentState: unknown | null
    agentStateVersion: number
    model: string | null
    modelReasoningEffort: string | null
    effort: string | null
    todos: unknown | null
    todosUpdatedAt: number | null
    teamState: unknown | null
    teamStateUpdatedAt: number | null
    active: boolean
    activeAt: number | null
    seq: number
    ownerAccountId: number | null
}

export type StoredMachine = {
    id: string
    namespace: string
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    runnerState: unknown | null
    runnerStateVersion: number
    active: boolean
    activeAt: number | null
    seq: number
    ownerAccountId: number | null
}

export type StoredMessage = {
    id: string
    sessionId: string
    content: unknown
    createdAt: number
    seq: number
    localId: string | null
    invokedAt: number | null
    scheduledAt: number | null
}

export type StoredUser = {
    id: number
    platform: string
    platformUserId: string
    namespace: string
    createdAt: number
}

export type AccountRole = 'admin' | 'user'

export type StoredAccount = {
    id: number
    username: string
    passwordHash: string | null
    authProvider: string
    role: AccountRole
    defaultNamespace: string
    createdAt: number
    disabledAt: number | null
}

export type StoredApiToken = {
    id: number
    accountId: number
    name: string | null
    tokenHash: string
    namespace: string
    createdAt: number
    lastUsedAt: number | null
    revokedAt: number | null
}

export type ResourceType = 'machine' | 'session'
export type GrantRole = 'viewer' | 'operator'

export type StoredResourceGrant = {
    id: number
    resourceType: ResourceType
    resourceId: string
    granteeAccountId: number
    role: GrantRole
    createdAt: number
}

export type StoredPushSubscription = {
    id: number
    namespace: string
    endpoint: string
    p256dh: string
    auth: string
    createdAt: number
}

export type VersionedUpdateResult<T> =
    | { result: 'success'; version: number; value: T }
    | { result: 'version-mismatch'; version: number; value: T }
    | { result: 'error' }
