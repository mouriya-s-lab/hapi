import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { filterVisibleSessions } from './sessionListFilters'

function makeSummary(id: string, archivedAt?: number): SessionSummary {
    return {
        id,
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: { path: '/tmp/p', ...(archivedAt !== undefined ? { archivedAt } : {}) },
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        model: null,
        effort: null
    }
}

describe('filterVisibleSessions', () => {
    const sessions = [makeSummary('plain'), makeSummary('archived', 123), makeSummary('null-meta')]

    it('returns all sessions unchanged when hideArchived is off', () => {
        expect(filterVisibleSessions(sessions, false)).toBe(sessions)
    })

    it('drops only sessions with an archivedAt marker when hideArchived is on', () => {
        const visible = filterVisibleSessions(sessions, true)
        expect(visible.map((s) => s.id)).toEqual(['plain', 'null-meta'])
    })

    it('keeps sessions with null metadata', () => {
        const withNullMeta: SessionSummary = { ...makeSummary('x'), metadata: null }
        expect(filterVisibleSessions([withNullMeta], true)).toEqual([withNullMeta])
    })
})
