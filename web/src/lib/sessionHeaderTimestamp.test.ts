import { describe, expect, it } from 'vitest'
import { formatSessionHeaderTimestamp } from './sessionHeaderTimestamp'

describe('formatSessionHeaderTimestamp', () => {
    it('formats a session timestamp in the selected locale', () => {
        const value = new Date(2026, 6, 26, 8, 53).getTime()
        expect(formatSessionHeaderTimestamp(value, 'en-US')).toMatch(/Jul 26, 2026.*08:53 AM/)
        expect(formatSessionHeaderTimestamp(value, 'zh-CN')).toContain('2026年7月26日')
    })

    it('rejects missing and invalid timestamps', () => {
        expect(formatSessionHeaderTimestamp(0)).toBeNull()
        expect(formatSessionHeaderTimestamp(Number.NaN)).toBeNull()
    })
})
