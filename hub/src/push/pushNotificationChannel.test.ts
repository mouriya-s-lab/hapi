import { describe, expect, it } from 'bun:test'
import type { Session } from '../sync/syncEngine'
import { PushNotificationChannel } from './pushNotificationChannel'
import type { PushPayload } from './pushService'
import { Store } from '../store'

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-task-toast',
        namespace: 'default',
        name: 'Demo task',
        active: true,
        metadata: { flavor: 'codex' },
        ...overrides
    } as Session
}

describe('PushNotificationChannel', () => {
    it('sends task notifications to visible web clients before falling back to push', async () => {
        const store = new Store(':memory:')
        const pushed: Array<{ namespace: string; payload: PushPayload }> = []
        const toasts: unknown[] = []
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (namespace: string, payload: PushPayload) => {
                    pushed.push({ namespace, payload })
                }
            } as never,
            {
                sendToast: async (_namespace: string, event: unknown) => {
                    toasts.push(event)
                    return new Set([1])
                }
            } as never,
            {
                hasVisibleConnection: () => true
            } as never,
            '',
            store
        )

        await channel.sendTaskNotification(createSession(), {
            status: 'completed',
            summary: 'Background work finished'
        })

        expect(toasts).toHaveLength(1)
        expect(pushed).toHaveLength(0)
    })

    it('does not reuse one replacement tag for all task notifications in a session', async () => {
        const store = new Store(':memory:')
        const owner = store.accounts.create({ username: 'task-owner', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        const storedSession = store.sessions.getOrCreateSession('session-task-toast', {}, null, 'default', undefined, undefined, undefined, undefined, owner.id)
        const pushed: Array<{ namespace: string; payload: PushPayload }> = []
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (namespace: string, payload: PushPayload) => {
                    pushed.push({ namespace, payload })
                }
            } as never,
            {
                sendToast: async () => new Set()
            } as never,
            {
                hasVisibleConnection: () => false
            } as never,
            '',
            store
        )

        await channel.sendTaskNotification(createSession({ id: storedSession.id }), {
            status: 'completed',
            summary: 'First task'
        })
        await channel.sendTaskNotification(createSession({ id: storedSession.id }), {
            status: 'failed',
            summary: 'Second task'
        })

        expect(pushed).toHaveLength(2)
        expect(pushed[0].payload.tag).toBeUndefined()
        expect(pushed[1].payload.tag).toBeUndefined()
    })

    it('pushes to offline audience accounts when another account received the SSE toast', async () => {
        const store = new Store(':memory:')
        const owner = store.accounts.create({ username: 'owner', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        const grantee = store.accounts.create({ username: 'grantee', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        const session = store.sessions.getOrCreateSession('toast-audience', {}, null, 'default', undefined, undefined, undefined, undefined, owner.id)
        store.grants.upsert({ resourceType: 'session', resourceId: session.id, granteeAccountId: grantee.id, role: 'operator' })
        let pushedAudience = new Set<number>()
        const channel = new PushNotificationChannel(
            { sendToNamespace: async (_namespace: string, _payload: PushPayload, audience: Set<number>) => { pushedAudience = audience } } as never,
            { sendToast: async () => new Set([owner.id]) } as never,
            { hasVisibleConnection: () => true } as never,
            '', store
        )

        await channel.sendReady(createSession({ id: session.id }))

        expect([...pushedAudience]).toEqual([grantee.id])
    })
})
