import { describe, expect, it } from 'vitest'
import { formatCcSwitchSourceLabel, getSessionModelLabel } from './sessionModelLabel'

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

describe('formatCcSwitchSourceLabel', () => {
    it('renders valid remaining usage and falls back to the provider for invalid usage', () => {
        expect(formatCcSwitchSourceLabel('Provider', {
            planName: 'Pro', total: 100, remaining: 12.5, unit: 'USD', isValid: true, invalidMessage: null
        }, '余 ')).toBe('Provider · 余 $12.5')
        expect(formatCcSwitchSourceLabel('Provider', {
            planName: null, total: null, remaining: null, unit: null, isValid: false, invalidMessage: 'expired'
        }, '余 ')).toBe('Provider')
    })
})
