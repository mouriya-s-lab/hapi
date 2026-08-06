import { describe, expect, it } from 'vitest'
import { createSerialAsyncQueue } from './serialAsyncQueue'

describe('createSerialAsyncQueue', () => {
    it('runs enqueued work in order even when the second starts while the first is pending', async () => {
        const enqueue = createSerialAsyncQueue()
        const order: number[] = []
        let releaseFirst!: () => void
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve
        })

        const first = enqueue(async () => {
            await firstGate
            order.push(1)
        })
        const second = enqueue(async () => {
            order.push(2)
        })

        expect(order).toEqual([])
        releaseFirst()
        await Promise.all([first, second])
        expect(order).toEqual([1, 2])
    })

    it('continues after a rejected run', async () => {
        const enqueue = createSerialAsyncQueue()
        const order: number[] = []
        await enqueue(async () => {
            order.push(1)
            throw new Error('boom')
        }).catch(() => undefined)
        await enqueue(async () => {
            order.push(2)
        })
        expect(order).toEqual([1, 2])
    })
})
