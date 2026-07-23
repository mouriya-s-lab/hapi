import { afterEach, describe, expect, it } from 'vitest'
import type { NotificationChannel } from '../../hub/src/notifications/notificationTypes'
import type { Session } from '../../hub/src/sync/syncEngine'
import { MultiUserGatewayStore } from './gatewayStore'
import { MultiUserNotificationAdapter } from './notificationAdapter'

const stores: MultiUserGatewayStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })

const session = { id: 's1', namespace: 'runtime', active: true } as Session

describe('MultiUserNotificationAdapter', () => {
    it('sends readable notifications to viewers but permission actions only to operators', async () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        const owner = store.createAccount('owner', 'user', 'owner-ns')
        const viewer = store.createAccount('viewer', 'user', 'viewer-ns')
        const operator = store.createAccount('operator', 'user', 'operator-ns')
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

        expect(ready.sort()).toEqual(['operator-ns', 'owner-ns', 'viewer-ns'])
        expect(permission.sort()).toEqual(['operator-ns', 'owner-ns'])
    })
})
