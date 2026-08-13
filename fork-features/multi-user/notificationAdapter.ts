import type { NotificationChannel, TaskNotification } from '../../hub/src/notifications/notificationTypes'
import type { Store } from '../../hub/src/store'
import type { Session } from '../../hub/src/sync/syncEngine'
import type { MultiUserGatewayStore } from './gatewayStore'

export type NotificationNamespaceResolver = (accountId: number) => string[]
export type PushEndpointResolver = (
    session: Session,
    capability: 'read' | 'operate'
) => ReadonlySet<string> | undefined

function fallbackNamespacesForAccount(store: MultiUserGatewayStore, accountId: number): string[] {
    const account = store.getAccount(accountId)
    return account && account.disabledAt === null ? [account.defaultNamespace] : []
}

export function createPushNotificationRouting(
    gatewayStore: MultiUserGatewayStore,
    coreStore: Store
): {
    namespacesForAccount: NotificationNamespaceResolver
    endpointsForAudience: PushEndpointResolver
} {
    return {
        namespacesForAccount(accountId) {
            const namespaces = gatewayStore.listPushSubscriptionNamespaces(accountId)
            return namespaces.length > 0
                ? namespaces
                : fallbackNamespacesForAccount(gatewayStore, accountId)
        },
        endpointsForAudience(session, capability) {
            const audienceAccountIds = new Set(
                gatewayStore.listAudienceAccountIds('session', session.id, capability)
            )
            const accountIdByEndpoint = new Map(
                gatewayStore.listPushSubscriptionAccounts(session.namespace)
                    .map(binding => [binding.endpoint, binding.accountId])
            )
            return new Set(
                coreStore.push.getPushSubscriptionsByNamespace(session.namespace)
                    .filter(subscription => {
                        const accountId = accountIdByEndpoint.get(subscription.endpoint)
                        return accountId === undefined || audienceAccountIds.has(accountId)
                    })
                    .map(subscription => subscription.endpoint)
            )
        }
    }
}

export function createTelegramNotificationNamespaceResolver(
    gatewayStore: MultiUserGatewayStore,
    coreStore: Store
): NotificationNamespaceResolver {
    return function namespacesForAccount(accountId): string[] {
        const namespaces = gatewayStore.listExternalIdentities(accountId, 'telegram')
            .map(binding => coreStore.users.getUser(binding.platform, binding.platformUserId))
            .filter(user => user !== null)
            .map(user => user.namespace)
        return namespaces.length > 0
            ? Array.from(new Set(namespaces))
            : fallbackNamespacesForAccount(gatewayStore, accountId)
    }
}

export class MultiUserNotificationAdapter implements NotificationChannel {
    constructor(
        private readonly store: MultiUserGatewayStore,
        private readonly downstream: NotificationChannel,
        private readonly namespacesForAccount: NotificationNamespaceResolver =
            accountId => fallbackNamespacesForAccount(store, accountId)
    ) {}

    private async fanOut(session: Session, capability: 'read' | 'operate', send: (copy: Session) => Promise<void>): Promise<void> {
        const binding = this.store.getResource('session', session.id)
        if (!binding) {
            await send(session)
            return
        }
        const namespaces = this.store.listAudienceAccountIds('session', session.id, capability)
            .flatMap(this.namespacesForAccount)
        await Promise.all(Array.from(new Set(namespaces)).map(namespace => send({ ...session, namespace })))
    }

    async sendReady(session: Session): Promise<void> {
        await this.fanOut(session, 'read', copy => this.downstream.sendReady(copy))
    }

    async sendPermissionRequest(session: Session): Promise<void> {
        await this.fanOut(session, 'operate', copy => this.downstream.sendPermissionRequest(copy))
    }

    async sendTaskNotification(session: Session, notification: TaskNotification): Promise<void> {
        await this.fanOut(session, 'read', copy => this.downstream.sendTaskNotification(copy, notification))
    }
}
