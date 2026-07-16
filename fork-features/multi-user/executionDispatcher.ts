import type { Capability, DispatchDecision, ResourceType } from './domain'
import type { MultiUserGatewayStore } from './gatewayStore'

const permitted = (level: 'none' | 'viewer' | 'operator' | 'owner', capability: Capability): boolean => {
    if (capability === 'read') return level !== 'none'
    if (capability === 'operate') return level === 'operator' || level === 'owner'
    return level === 'owner'
}

export class ExecutionDispatcher {
    constructor(private readonly store: MultiUserGatewayStore) {}

    authorize(input: { accountId: number; capability: Capability; resource?: { type: ResourceType; id: string } }): DispatchDecision {
        const account = this.store.getAccount(input.accountId)
        if (!account || account.disabledAt !== null) return { kind: 'deny', reason: 'account-unavailable' }
        if (!input.resource) {
            return { kind: 'allow', context: { account, namespace: account.defaultNamespace, capability: input.capability, resource: null } }
        }
        const resource = this.store.getResource(input.resource.type, input.resource.id)
        if (!resource) return { kind: 'deny', reason: 'resource-not-found' }
        const level = account.role === 'admin' || resource.ownerAccountId === account.id
            ? 'owner'
            : this.store.getGrant(input.resource.type, input.resource.id, account.id) ?? 'none'
        if (!permitted(level, input.capability)) return { kind: 'deny', reason: 'insufficient-access' }
        return { kind: 'allow', context: { account, namespace: resource.coreNamespace, capability: input.capability, resource } }
    }
}
