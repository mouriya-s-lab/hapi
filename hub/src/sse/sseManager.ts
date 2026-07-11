import type { SyncEvent } from '../sync/syncEngine'
import type { VisibilityState } from '../visibility/visibilityTracker'
import type { VisibilityTracker } from '../visibility/visibilityTracker'

export type SSESubscription = {
    id: string
    namespace: string
    all: boolean
    sessionId: string | null
    machineId: string | null
    accountId: number
    role: 'admin' | 'user'
}

type SSEConnection = SSESubscription & {
    send: (event: SyncEvent) => void | Promise<void>
    sendHeartbeat: () => void | Promise<void>
}

export type SSEAccessDeps = {
    listReadableAccountIds: (resourceType: 'session' | 'machine', resourceId: string) => Set<number>
}

type EventResource = { type: 'session' | 'machine'; id: string } | null

function resolveEventResource(event: SyncEvent): EventResource {
    switch (event.type) {
        case 'heartbeat':
        case 'connection-changed':
        case 'session-removed':
            return null
        case 'machine-updated':
            return { type: 'machine', id: event.machineId }
        case 'toast':
            return event.data.sessionId ? { type: 'session', id: event.data.sessionId } : null
        default:
            return 'sessionId' in event ? { type: 'session', id: event.sessionId } : null
    }
}

export class SSEManager {
    private readonly connections: Map<string, SSEConnection> = new Map()
    private heartbeatTimer: NodeJS.Timeout | null = null
    private readonly heartbeatMs: number
    private readonly visibilityTracker: VisibilityTracker
    private readonly accessDeps: SSEAccessDeps

    constructor(heartbeatMs: number, visibilityTracker: VisibilityTracker, accessDeps: SSEAccessDeps) {
        this.heartbeatMs = heartbeatMs
        this.visibilityTracker = visibilityTracker
        this.accessDeps = accessDeps
    }

    subscribe(options: {
        id: string
        namespace: string
        all?: boolean
        sessionId?: string | null
        machineId?: string | null
        accountId: number
        role: 'admin' | 'user'
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
            accountId: options.accountId,
            role: options.role,
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

    private buildAccessCheck(event: SyncEvent): (connection: SSEConnection) => boolean {
        const resource = resolveEventResource(event)
        if (!resource) {
            return () => true
        }
        let audience: Set<number> | null = null
        return (connection) => {
            if (connection.role === 'admin') {
                return true
            }
            audience ??= this.accessDeps.listReadableAccountIds(resource.type, resource.id)
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
