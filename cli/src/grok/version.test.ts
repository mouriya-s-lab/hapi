import { describe, expect, it } from 'vitest'
import { assertSupportedGrokVersion, parseGrokVersionJson } from './version'

describe('Grok version contract', () => {
    it('parses the supported machine-readable version', () => {
        expect(parseGrokVersionJson('{"currentVersion":"0.2.99 (abc)","channel":"unknown"}')).toEqual([0, 2, 99])
        expect(() => assertSupportedGrokVersion([0, 2, 99])).not.toThrow()
    })

    it('rejects an older protocol baseline', () => {
        expect(() => assertSupportedGrokVersion([0, 2, 98])).toThrow('>= 0.2.99')
    })
})
