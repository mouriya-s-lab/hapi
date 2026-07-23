import { describe, expect, it, vi } from 'vitest'
import { RunnerUsageMonitor } from './runnerUsageMonitor'
import type { UsageProvider } from './types'

function snapshot(providerId: string) {
    return { providerId, displayName: providerId, plan: null, metrics: [], fetchedAt: '2026-07-12T00:00:00Z' }
}

describe('RunnerUsageMonitor', () => {
    it('detects reachability once, then refreshes only the fixed reachable set across reconnects', async () => {
        const provider: UsageProvider = {
            id: 'reachable',
            name: 'Reachable',
            inspect: vi.fn(async () => ({ id: 'reachable', name: 'Reachable', available: true })),
            query: vi.fn(async () => snapshot('reachable'))
        }
        const publish = vi.fn(async () => undefined)
        const monitor = new RunnerUsageMonitor(60_000, [provider])

        await monitor.connect(publish)
        monitor.disconnect()
        await monitor.connect(publish)
        monitor.disconnect()

        expect(provider.inspect).toHaveBeenCalledTimes(1)
        expect(provider.query).toHaveBeenCalledTimes(2)
        expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
            providers: [{ id: 'reachable', name: 'Reachable' }],
            snapshots: [snapshot('reachable')]
        }))
    })

    it('does not start refresh work when every provider is unreachable', async () => {
        const provider: UsageProvider = {
            id: 'offline',
            name: 'Offline',
            inspect: vi.fn(async () => ({ id: 'offline', name: 'Offline', available: false })),
            query: vi.fn(async () => snapshot('offline'))
        }
        const publish = vi.fn(async () => undefined)
        const monitor = new RunnerUsageMonitor(5, [provider])

        await monitor.connect(publish)
        await new Promise((resolve) => setTimeout(resolve, 20))
        monitor.disconnect()

        expect(provider.inspect).toHaveBeenCalledTimes(1)
        expect(provider.query).not.toHaveBeenCalled()
        expect(publish).toHaveBeenCalledTimes(1)
        expect(publish).toHaveBeenCalledWith(expect.objectContaining({ providers: [], snapshots: [] }))
    })
})
