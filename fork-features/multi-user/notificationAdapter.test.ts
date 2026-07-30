import { afterEach, describe, expect, it } from 'vitest'
import type { NotificationChannel } from '../../hub/src/notifications/notificationTypes'
import { Store } from '../../hub/src/store'
import type { Session } from '../../hub/src/sync/syncEngine'
import { MultiUserGatewayStore } from './gatewayStore'
import {
    createPushNotificationRouting,
    createTelegramNotificationNamespaceResolver,
    MultiUserNotificationAdapter
} from './notificationAdapter'

const stores: MultiUserGatewayStore[] = []
const coreStores: Store[] = []
afterEach(() => {
    for (const store of stores.splice(0)) store.close()
    for (const store of coreStores.splice(0)) store.close()
})

const session = { id: 's1', namespace: 'runtime', active: true } as Session

describe('MultiUserNotificationAdapter', () => {
    it('sends readable notifications to viewers but permission actions only to operators', async () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        const owner = store.createAccount('owner', 'user', 'owner-ns')
        const viewer = store.createAccount('viewer', 'user', 'viewer-ns')
        const operator = store.createAccount('operator', 'user', 'operator-ns')
        const admin = store.createAccount('admin', 'admin', 'admin-ns')
        store.bindResource({ resourceType: 'session', resourceId: 's1', ownerAccountId: owner.id, coreNamespace: 'runtime' })
        store.grant('session', 's1', viewer.id, 'viewer')
        store.grant('session', 's1', operator.id, 'operator')
        const ready: string[] = []
        const permission: string[] = []
        const downstream: NotificationChannel = {
            sendReady: async value => { ready.push(value.namespace) },
            sendPermissionRequest: async value => { permission.push(value.namespace) },
            sendTaskNotification: async () => {}
        }
        const adapter = new MultiUserNotificationAdapter(store, downstream)

        await adapter.sendReady(session)
        await adapter.sendPermissionRequest(session)

        expect(ready.sort()).toEqual(['admin-ns', 'operator-ns', 'owner-ns', 'viewer-ns'])
        expect(permission.sort()).toEqual(['admin-ns', 'operator-ns', 'owner-ns'])
    })

    it('routes migrated Telegram and Push destinations through their account bindings', () => {
        const gatewayStore = new MultiUserGatewayStore(':memory:')
        const coreStore = new Store(':memory:')
        stores.push(gatewayStore)
        coreStores.push(coreStore)
        const owner = gatewayStore.createAccount('owner', 'user', 'account-owner')
        const viewer = gatewayStore.createAccount('viewer', 'user', 'account-viewer')
        gatewayStore.bindResource({
            resourceType: 'session',
            resourceId: session.id,
            ownerAccountId: owner.id,
            coreNamespace: session.namespace
        })
        gatewayStore.grant('session', session.id, viewer.id, 'viewer')

        coreStore.users.addUser('telegram', '42', 'telegram-tenant')
        gatewayStore.bindExternalIdentity({
            platform: 'telegram',
            platformUserId: '42',
            accountId: viewer.id
        })
        expect(createTelegramNotificationNamespaceResolver(gatewayStore, coreStore)(viewer.id))
            .toEqual(['telegram-tenant'])

        coreStore.push.addPushSubscription('push-tenant', {
            endpoint: 'https://push.test/viewer',
            p256dh: 'p256dh',
            auth: 'auth'
        })
        coreStore.push.addPushSubscription('push-tenant', {
            endpoint: 'https://push.test/legacy-unbound',
            p256dh: 'p256dh',
            auth: 'auth'
        })
        gatewayStore.bindPushSubscriptionAccount({
            namespace: 'push-tenant',
            endpoint: 'https://push.test/viewer',
            accountId: viewer.id
        })
        const routing = createPushNotificationRouting(gatewayStore, coreStore)
        expect(routing.namespacesForAccount(viewer.id)).toEqual(['push-tenant'])
        expect(Array.from(routing.endpointsForAudience(
            { ...session, namespace: 'push-tenant' },
            'operate'
        ) ?? []).sort()).toEqual(['https://push.test/legacy-unbound'])
        expect(Array.from(routing.endpointsForAudience(
            { ...session, namespace: 'push-tenant' },
            'read'
        ) ?? []).sort()).toEqual([
            'https://push.test/legacy-unbound',
            'https://push.test/viewer'
        ])
    })
})
