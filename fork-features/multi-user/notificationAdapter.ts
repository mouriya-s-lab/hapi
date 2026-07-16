import type { NotificationChannel, TaskNotification } from '../../hub/src/notifications/notificationTypes'
import type { Session } from '../../hub/src/sync/syncEngine'
import type { MultiUserGatewayStore } from './gatewayStore'

export class MultiUserNotificationAdapter implements NotificationChannel {
    constructor(
        private readonly store: MultiUserGatewayStore,
        private readonly downstream: NotificationChannel
    ) {}

    private async fanOut(session: Session, capability: 'read' | 'operate', send: (copy: Session) => Promise<void>): Promise<void> {
        const binding = this.store.getResource('session', session.id)
        if (!binding) {
            await send(session)
            return
        }
        const namespaces = this.store.listAudienceAccountIds('session', session.id, capability)
            .map(id => this.store.getAccount(id))
            .filter(account => account !== null && account.disabledAt === null)
            .map(account => account!.defaultNamespace)
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
