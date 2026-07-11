import { describe, expect, it } from 'vitest'
import { formatUsageSnapshotLabel, getSessionModelLabel } from './sessionModelLabel'

describe('getSessionModelLabel', () => {
    it('prefers the explicit session model', () => {
        expect(getSessionModelLabel({ model: 'gpt-5.4' })).toEqual({
            key: 'session.item.model',
            value: 'gpt-5.4'
        })
    })

    it('renders friendly labels for known Claude aliases', () => {
        expect(getSessionModelLabel({ model: 'opus' })).toEqual({
            key: 'session.item.model',
            value: 'Opus'
        })
        expect(getSessionModelLabel({ model: 'fable' })).toEqual({
            key: 'session.item.model',
            value: 'Fable'
        })
    })

    it('returns null when no model is available', () => {
        expect(getSessionModelLabel({})).toBeNull()
    })
})

describe('formatUsageSnapshotLabel', () => {
    it('renders the first normalized progress metric', () => {
        expect(formatUsageSnapshotLabel({
            providerId: 'openusage', displayName: 'Claude', plan: 'Max 20x', fetchedAt: '2026-07-12T00:00:00Z',
            metrics: [{ type: 'progress', label: 'Session', used: 24, limit: 100, unit: 'percent', resetsAt: null }]
        }, '余 ')).toBe('Claude · Session 余 76%')
    })
})
