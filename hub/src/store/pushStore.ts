import type { Database } from 'bun:sqlite'

import type { StoredPushSubscription } from './types'
import { addPushSubscription, getPushSubscriptionsByNamespace, removeExpiredPushSubscription, removePushSubscription } from './pushSubscriptions'

export class PushStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    addPushSubscription(namespace: string, subscription: { endpoint: string; p256dh: string; auth: string; accountId: number }): void {
        addPushSubscription(this.db, namespace, subscription)
    }

    removePushSubscription(namespace: string, endpoint: string, accountId: number): void {
        removePushSubscription(this.db, namespace, endpoint, accountId)
    }

    removeExpiredPushSubscription(namespace: string, endpoint: string): void {
        removeExpiredPushSubscription(this.db, namespace, endpoint)
    }

    getPushSubscriptionsByNamespace(namespace: string): StoredPushSubscription[] {
        return getPushSubscriptionsByNamespace(this.db, namespace)
    }
}
