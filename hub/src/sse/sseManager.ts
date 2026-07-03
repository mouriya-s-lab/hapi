import type { SyncEvent } from '../sync/syncEngine'
import type { VisibilityState } from '../visibility/visibilityTracker'
import type { VisibilityTracker } from '../visibility/visibilityTracker'

export type SSESubscription = {
    id: string
    namespace: string
    all: boolean
    sessionId: string | null
    machineId: string | null
    /** Account the subscriber authenticated as; null = legacy token without account claims. */
    accountId: number | null
    role: 'admin' | 'user'
}

type SSEConnection = SSESubscription & {
    send: (event: SyncEvent) => void | Promise<void>
    sendHeartbeat: () => void | Promise<void>
}

/**
 * Store-backed authorization for event fan-out. When provided, session- and
 * machine-scoped events are only delivered to admins, the resource owner, and
 * grantees — namespace membership alone is no longer enough to observe other
 * users' activity.
 */
export type SSEAccessDeps = {
    listReadableAccountIds: (resourceType: 'session' | 'machine', resourceId: string) => Set<number>
}

type EventResource = { type: 'session' | 'machine'; id: string } | null

function resolveEventResource(event: SyncEvent): EventResource {
    if (event.type === 'heartbeat' || event.type === 'connection-changed') {
        return null
    }
    // session-removed fires after the row is deleted, so ownership can no
    // longer be resolved; it carries no content beyond the id, deliver
    // namespace-wide so the owner's other clients still drop the session.
    if (event.type === 'session-removed') {
        return null
    }
    if (event.type === 'machine-updated') {
        return { type: 'machine', id: event.machineId }
    }
    if (event.type === 'toast') {
        return event.data.sessionId ? { type: 'session', id: event.data.sessionId } : null
    }
    if ('sessionId' in event && typeof event.sessionId === 'string') {
        return { type: 'session', id: event.sessionId }
    }
    return null
}

export class SSEManager {
    private readonly connections: Map<string, SSEConnection> = new Map()
    private heartbeatTimer: NodeJS.Timeout | null = null
    private readonly heartbeatMs: number
    private readonly visibilityTracker: VisibilityTracker
    private readonly accessDeps: SSEAccessDeps | null

    constructor(heartbeatMs = 30_000, visibilityTracker: VisibilityTracker, accessDeps?: SSEAccessDeps) {
        this.heartbeatMs = heartbeatMs
        this.visibilityTracker = visibilityTracker
        this.accessDeps = accessDeps ?? null
    }

    subscribe(options: {
        id: string
        namespace: string
        all?: boolean
        sessionId?: string | null
        machineId?: string | null
        accountId?: number | null
        role?: 'admin' | 'user'
        visibility?: VisibilityState
        send: (event: SyncEvent) => void | Promise<void>
        sendHeartbeat: () => void | Promise<void>
    }): SSESubscription {
        const subscription: SSEConnection = {
            id: options.id,
            namespace: options.namespace,
            all: Boolean(options.all),
            sessionId: options.sessionId ?? null,
            machineId: options.machineId ?? null,
            accountId: options.accountId ?? null,
            role: options.role ?? 'user',
            send: options.send,
            sendHeartbeat: options.sendHeartbeat
        }

        this.connections.set(subscription.id, subscription)
        this.visibilityTracker.registerConnection(
            subscription.id,
            subscription.namespace,
            options.visibility ?? 'hidden'
        )
        this.ensureHeartbeat()
        return {
            id: subscription.id,
            namespace: subscription.namespace,
            all: subscription.all,
            sessionId: subscription.sessionId,
            machineId: subscription.machineId,
            accountId: subscription.accountId,
            role: subscription.role
        }
    }

    unsubscribe(id: string): void {
        this.connections.delete(id)
        this.visibilityTracker.removeConnection(id)
        if (this.connections.size === 0) {
            this.stopHeartbeat()
        }
    }

    async sendToast(namespace: string, event: Extract<SyncEvent, { type: 'toast' }>): Promise<number> {
        const canAccess = this.buildAccessCheck(event)
        const deliveries: Array<Promise<{ id: string; ok: boolean }>> = []
        for (const connection of this.connections.values()) {
            if (connection.namespace !== namespace) {
                continue
            }
            if (!this.visibilityTracker.isVisibleConnection(connection.id)) {
                continue
            }
            if (!canAccess(connection)) {
                continue
            }

            deliveries.push(
                Promise.resolve(connection.send(event))
                    .then(() => ({ id: connection.id, ok: true }))
                    .catch(() => ({ id: connection.id, ok: false }))
            )
        }

        if (deliveries.length === 0) {
            return 0
        }

        const results = await Promise.all(deliveries)
        let successCount = 0
        for (const result of results) {
            if (result.ok) {
                successCount += 1
                continue
            }
            this.unsubscribe(result.id)
        }

        return successCount
    }

    broadcast(event: SyncEvent): void {
        const canAccess = this.buildAccessCheck(event)
        for (const connection of this.connections.values()) {
            if (!this.shouldSend(connection, event)) {
                continue
            }
            if (!canAccess(connection)) {
                continue
            }

            void Promise.resolve(connection.send(event)).catch(() => {
                this.unsubscribe(connection.id)
            })
        }
    }

    stop(): void {
        this.stopHeartbeat()
        for (const id of this.connections.keys()) {
            this.visibilityTracker.removeConnection(id)
        }
        this.connections.clear()
    }

    /**
     * Per-event ownership check, resolved lazily and at most once per event
     * regardless of connection count. Without accessDeps (tests, legacy
     * setups) every connection passes, preserving namespace-only filtering.
     */
    private buildAccessCheck(event: SyncEvent): (connection: SSEConnection) => boolean {
        const deps = this.accessDeps
        if (!deps) {
            return () => true
        }
        const resource = resolveEventResource(event)
        if (!resource) {
            return () => true
        }
        let audience: Set<number> | null = null
        return (connection) => {
            if (connection.role === 'admin') {
                return true
            }
            if (connection.accountId === null) {
                return false
            }
            if (!audience) {
                audience = deps.listReadableAccountIds(resource.type, resource.id)
            }
            return audience.has(connection.accountId)
        }
    }

    private ensureHeartbeat(): void {
        if (this.heartbeatTimer || this.heartbeatMs <= 0) {
            return
        }

        this.heartbeatTimer = setInterval(() => {
            for (const connection of this.connections.values()) {
                void Promise.resolve(connection.sendHeartbeat()).catch(() => {
                    this.unsubscribe(connection.id)
                })
            }
        }, this.heartbeatMs)
    }

    private stopHeartbeat(): void {
        if (!this.heartbeatTimer) {
            return
        }

        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
    }

    private shouldSend(connection: SSEConnection, event: SyncEvent): boolean {
        if (event.type !== 'connection-changed') {
            const eventNamespace = event.namespace
            if (!eventNamespace || eventNamespace !== connection.namespace) {
                return false
            }
        }

        if (event.type === 'message-received' || event.type === 'scheduled-matured') {
            return connection.all || connection.sessionId === event.sessionId
        }

        if (event.type === 'connection-changed') {
            return true
        }

        if (connection.all) {
            return true
        }

        if ('sessionId' in event && connection.sessionId === event.sessionId) {
            return true
        }

        if ('machineId' in event && connection.machineId === event.machineId) {
            return true
        }

        return false
    }
}
