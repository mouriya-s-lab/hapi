import { describe, expect, it } from 'vitest'
import {
    formatCompactContextUsageLabel,
    formatContextUsageLabel,
    getContextUsageDetails,
    shouldShowCodexFastBadge
} from './StatusBar'

describe('context usage labels', () => {
    it('keeps the desktop label compact and expresses used capacity', () => {
        expect(formatContextUsageLabel(90_000, 258_000)).toBe('35% · 90k / 258k')
    })

    it('uses the compact parenthesized mobile label with a fixed English suffix', () => {
        expect(formatCompactContextUsageLabel(186_000, 262_000)).toBe('ctx 262k (29% left)')
    })

    it('orders cache, used, and remaining metrics for the desktop details', () => {
        expect(getContextUsageDetails(90_000, 258_000, 86_000)).toEqual({
            cacheRead: '86k',
            used: '90k',
            usedPercentage: 35,
            remaining: '168k',
            remainingPercentage: 65
        })
    })

    it('keeps external and detailed percentages complementary at rounding midpoints', () => {
        expect(formatContextUsageLabel(69, 200)).toBe('35% · 69 / 200')
        expect(formatCompactContextUsageLabel(69, 200)).toBe('ctx 200 (65% left)')
        expect(getContextUsageDetails(69, 200, 0)).toMatchObject({
            usedPercentage: 35,
            remainingPercentage: 65
        })
    })
})

describe('shouldShowCodexFastBadge', () => {
    it('uses only the effective service tier', () => {
        expect(shouldShowCodexFastBadge('codex', undefined)).toBe(false)
        expect(shouldShowCodexFastBadge('codex', 'standard')).toBe(false)
        expect(shouldShowCodexFastBadge('codex', 'fast')).toBe(true)
        expect(shouldShowCodexFastBadge('codex', 'priority')).toBe(true)
        expect(shouldShowCodexFastBadge('claude', 'fast')).toBe(false)
    })
})
