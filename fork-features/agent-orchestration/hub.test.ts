import { describe, expect, test } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol'
import type { SyncEngine } from '../../hub/src/sync/syncEngine'
import { requirePromptConsumption, watchMessageConsumption } from './hub'

function consumptionSource(): {
    engine: Pick<SyncEngine, 'subscribe'>
    emit: (event: SyncEvent) => void
    subscriptionCount: () => number
} {
    let listener: (event: SyncEvent) => void = () => {}
    let activeSubscriptions = 0
    return {
        engine: {
            subscribe(nextListener) {
                listener = nextListener
                activeSubscriptions += 1
                return () => {
                    activeSubscriptions -= 1
                }
            }
        },
        emit: (event) => listener(event),
        subscriptionCount: () => activeSubscriptions
    }
}

describe('hapi agent prompt consumption wait', () => {
    test('settles only for the target local message and releases its subscription', async () => {
        const source = consumptionSource()
        const watcher = watchMessageConsumption(source.engine, 'target', 'prompt-local-id')
        let settled = false
        void watcher.promise.then(() => { settled = true })

        source.emit({
            type: 'messages-consumed',
            sessionId: 'other',
            localIds: ['prompt-local-id'],
            invokedAt: 1
        })
        expect(source.subscriptionCount()).toBe(1)

        source.emit({
            type: 'messages-consumed',
            sessionId: 'target',
            localIds: ['another-prompt'],
            invokedAt: 2
        })
        await Promise.resolve()
        expect(settled).toBe(false)
        expect(source.subscriptionCount()).toBe(1)

        source.emit({
            type: 'messages-consumed',
            sessionId: 'target',
            localIds: ['prompt-local-id'],
            invokedAt: 2
        })
        await watcher.promise
        expect(source.subscriptionCount()).toBe(0)
    })

    test('returns agent_prompt_stalled and cancels the subscription when no consumption arrives', async () => {
        const source = consumptionSource()
        const watcher = watchMessageConsumption(source.engine, 'target', 'prompt-local-id')

        await expect(requirePromptConsumption(watcher, 'target', 1)).rejects.toMatchObject({
            code: 'agent_prompt_stalled'
        })
        expect(source.subscriptionCount()).toBe(0)
    })
})
