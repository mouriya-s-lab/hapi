import { describe, expect, it } from 'bun:test'
import { SSEManager } from './sseManager'
import type { SyncEvent } from '../sync/syncEngine'
import { VisibilityTracker } from '../visibility/visibilityTracker'

const accessDeps = { listReadableAccountIds: () => new Set([1]) }

describe('SSEManager namespace filtering', () => {
    it('routes events to matching namespace', () => {
        const manager = new SSEManager(0, new VisibilityTracker(), accessDeps)
        const receivedAlpha: SyncEvent[] = []
        const receivedBeta: SyncEvent[] = []

        manager.subscribe({
            id: 'alpha',
            namespace: 'alpha',
            accountId: 1,
            role: 'user',
            all: true,
            send: (event) => {
                receivedAlpha.push(event)
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'beta',
            namespace: 'beta',
            accountId: 1,
            role: 'user',
            all: true,
            send: (event) => {
                receivedBeta.push(event)
            },
            sendHeartbeat: () => {}
        })

        manager.broadcast({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })

        expect(receivedAlpha).toHaveLength(1)
        expect(receivedBeta).toHaveLength(0)
    })

    it('broadcasts connection-changed to all namespaces', () => {
        const manager = new SSEManager(0, new VisibilityTracker(), accessDeps)
        const received: Array<{ id: string; event: SyncEvent }> = []

        manager.subscribe({
            id: 'alpha',
            namespace: 'alpha',
            accountId: 1,
            role: 'user',
            all: true,
            send: (event) => {
                received.push({ id: 'alpha', event })
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'beta',
            namespace: 'beta',
            accountId: 1,
            role: 'user',
            all: true,
            send: (event) => {
                received.push({ id: 'beta', event })
            },
            sendHeartbeat: () => {}
        })

        manager.broadcast({ type: 'connection-changed', data: { status: 'connected' } })

        expect(received).toHaveLength(2)
        expect(received.map((entry) => entry.id).sort()).toEqual(['alpha', 'beta'])
    })

    it('sends session removal only to admins and accounts that could read the session', () => {
        const manager = new SSEManager(0, new VisibilityTracker(), {
            listReadableAccountIds: () => new Set([1])
        })
        const received: string[] = []
        for (const [id, accountId, role] of [
            ['owner', 1, 'user'],
            ['stranger', 2, 'user'],
            ['admin', 3, 'admin']
        ] as const) {
            manager.subscribe({
                id, namespace: 'alpha', accountId, role, all: true,
                send: () => { received.push(id) },
                sendHeartbeat: () => {}
            })
        }

        manager.broadcast({ type: 'session-removed', sessionId: 's1', namespace: 'alpha' })

        expect(received.sort()).toEqual(['admin', 'owner'])
    })

    it('sends toast only to visible connections in a namespace', async () => {
        const manager = new SSEManager(0, new VisibilityTracker(), accessDeps)
        const received: Array<{ id: string; event: SyncEvent }> = []

        manager.subscribe({
            id: 'visible',
            namespace: 'alpha',
            accountId: 1,
            role: 'user',
            all: true,
            visibility: 'visible',
            send: (event) => {
                received.push({ id: 'visible', event })
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'hidden',
            namespace: 'alpha',
            accountId: 1,
            role: 'user',
            all: true,
            visibility: 'hidden',
            send: (event) => {
                received.push({ id: 'hidden', event })
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'other',
            namespace: 'beta',
            accountId: 1,
            role: 'user',
            all: true,
            visibility: 'visible',
            send: (event) => {
                received.push({ id: 'other', event })
            },
            sendHeartbeat: () => {}
        })

        const toastEvent: Extract<SyncEvent, { type: 'toast' }> = {
            type: 'toast',
            data: {
                title: 'Test',
                body: 'Toast body',
                sessionId: 'session-1',
                url: '/sessions/session-1'
            }
        }

        const delivered = await manager.sendToast('alpha', toastEvent)

        expect(delivered).toBe(1)
        expect(received).toHaveLength(1)
        expect(received[0]?.id).toBe('visible')
    })
})
