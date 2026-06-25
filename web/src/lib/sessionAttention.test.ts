import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { classifySessionAttention } from './sessionAttention'

function makeSummary(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: true,
        thinking: false,
        activeAt: 0,
        updatedAt: 1000,
        metadata: null,
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        pendingRequests: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        nextScheduledAt: null,
        model: null,
        effort: null,
        ...overrides
    }
}

describe('classifySessionAttention', () => {
    it('returns null for the selected session', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', pendingRequestKinds: ['permission'] }),
            { selected: true, lastSeenAt: 0 }
        )
        expect(attention).toBeNull()
    })

    it('prioritizes permission over unread activity', () => {
        const attention = classifySessionAttention(
            makeSummary({
                id: 'a',
                pendingRequestKinds: ['permission'],
                pendingRequestsCount: 1,
                updatedAt: 5000
            }),
            { selected: false, lastSeenAt: 0 }
        )
        expect(attention).toEqual({ kind: 'permission' })
    })

    it('handles summaries from older APIs without pendingRequestKinds', () => {
        const legacySummary = makeSummary({ id: 'legacy', active: false, updatedAt: 5000 }) as unknown as SessionSummary
        delete (legacySummary as Partial<SessionSummary>).pendingRequestKinds

        const attention = classifySessionAttention(
            legacySummary,
            { selected: false, lastSeenAt: 1000 }
        )

        expect(attention).toEqual({ kind: 'unread' })
    })

    it('shows background work without treating it as unread', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', backgroundTaskCount: 2, updatedAt: 5000 }),
            { selected: false, lastSeenAt: 0 }
        )
        expect(attention).toEqual({ kind: 'background' })
    })

    it('shows unread activity for inactive sessions updated since last seen', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', active: false, updatedAt: 5000 }),
            { selected: false, lastSeenAt: 1000 }
        )
        expect(attention).toEqual({ kind: 'unread' })
    })

    it('prefers unread over background for inactive sessions', () => {
        const attention = classifySessionAttention(
            makeSummary({
                id: 'a',
                active: false,
                backgroundTaskCount: 2,
                updatedAt: 5000
            }),
            { selected: false, lastSeenAt: 1000 }
        )
        expect(attention).toEqual({ kind: 'unread' })
    })

    it('shows ready for an active idle session waiting for the user', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', active: true, thinking: false }),
            { selected: false, lastSeenAt: 0 }
        )
        expect(attention).toEqual({ kind: 'ready' })
    })

    it('keeps showing ready even after the session has been seen (durable hint)', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', active: true, thinking: false, updatedAt: 1000 }),
            { selected: false, lastSeenAt: 5000 }
        )
        expect(attention).toEqual({ kind: 'ready' })
    })

    it('does not show ready while the agent is thinking', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', active: true, thinking: true }),
            { selected: false, lastSeenAt: 0 }
        )
        expect(attention).toBeNull()
    })

    it('does not show ready for the selected session', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', active: true, thinking: false }),
            { selected: true, lastSeenAt: 0 }
        )
        expect(attention).toBeNull()
    })

    it('prioritizes pending input over ready', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', active: true, thinking: false, pendingRequestKinds: ['input'] }),
            { selected: false, lastSeenAt: 0 }
        )
        expect(attention).toEqual({ kind: 'input' })
    })

    it('prioritizes background work over ready', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', active: true, thinking: false, backgroundTaskCount: 1 }),
            { selected: false, lastSeenAt: 0 }
        )
        expect(attention).toEqual({ kind: 'background' })
    })

    it('does not show ready for an inactive session', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', active: false, thinking: false, updatedAt: 1000 }),
            { selected: false, lastSeenAt: 5000 }
        )
        expect(attention).toBeNull()
    })
})
