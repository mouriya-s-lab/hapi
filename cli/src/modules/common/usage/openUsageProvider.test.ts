import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenUsageProvider } from './openUsageProvider'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe('OpenUsageProvider', () => {
    it('treats an empty 204 snapshot as reachable during one-time discovery', async () => {
        globalThis.fetch = Object.assign(vi.fn(async () => new Response(null, { status: 204 })), {
            preconnect: () => undefined
        })

        await expect(new OpenUsageProvider().inspect()).resolves.toEqual({
            id: 'openusage',
            name: 'OpenUsage',
            available: true
        })
    })

    it('normalizes the local HTTP API snapshot into the shared usage contract', async () => {
        globalThis.fetch = Object.assign(vi.fn(async () => new Response(JSON.stringify({
            providerId: 'claude', displayName: 'Claude', plan: 'Max 20x', fetchedAt: '2026-07-12T00:00:00Z',
            lines: [
                { type: 'progress', label: 'Session', used: 24, limit: 100, format: { kind: 'percent' }, resetsAt: null },
                { type: 'text', label: 'Today', value: '$1.35 · 178.6K tokens' },
                { type: 'barChart', label: 'Usage Trend', points: [{ label: '7/12', value: 42, valueLabel: '42 tokens' }], note: 'estimated' }
            ]
        }), { status: 200 })), { preconnect: () => undefined })

        await expect(new OpenUsageProvider().query({ subjectId: 'claude' })).resolves.toEqual({
            providerId: 'openusage', displayName: 'Claude', plan: 'Max 20x', fetchedAt: '2026-07-12T00:00:00Z',
            metrics: [
                { type: 'progress', label: 'Session', used: 24, limit: 100, unit: 'percent', resetsAt: null },
                { type: 'text', label: 'Today', value: '$1.35 · 178.6K tokens' },
                { type: 'barChart', label: 'Usage Trend', points: [{ label: '7/12', value: 42, valueLabel: '42 tokens' }], note: 'estimated' }
            ]
        })
    })

    it('rejects unavailable and malformed local API responses', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ providerId: 'claude' }), { status: 200 }))
        globalThis.fetch = Object.assign(fetchMock, { preconnect: () => undefined })
        const provider = new OpenUsageProvider()
        await expect(provider.query({ subjectId: 'claude' })).rejects.toThrow('no cached snapshot')
        await expect(provider.query({ subjectId: 'claude' })).rejects.toThrow()
    })
})
