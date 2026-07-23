export type AccountRole = 'admin' | 'user'
export type GrantRole = 'viewer' | 'operator'
export type ResourceType = 'session' | 'machine'
export type Capability = 'read' | 'operate' | 'administer'

export type Account = {
    id: number
    username: string
    passwordHash: string | null
    role: AccountRole
    defaultNamespace: string
    disabledAt: number | null
    memory: string | null
}

export type ApiToken = {
    id: number
    accountId: number
    name: string | null
    tokenHash: string
    createdAt: number
    revokedAt: number | null
}

export type ResourceBinding = {
    resourceType: ResourceType
    resourceId: string
    ownerAccountId: number
    coreNamespace: string
}

export type ExecutionContext = {
    account: Account
    namespace: string
    capability: Capability
    resource: ResourceBinding | null
}

export type DispatchDecision =
    | { kind: 'allow'; context: ExecutionContext }
    | { kind: 'deny'; reason: 'account-unavailable' | 'resource-not-found' | 'insufficient-access' }
