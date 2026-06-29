import { describe, it, expect } from 'bun:test'
import { MetadataSchema } from './schemas'

describe('Metadata fork fields', () => {
    it('accepts forkedFrom and forkedAt', () => {
        const parsed = MetadataSchema.parse({
            path: '/tmp/work',
            host: 'localhost',
            forkedFrom: 'src-session-id',
            forkedAt: 1719523200000
        })
        expect(parsed.forkedFrom).toBe('src-session-id')
        expect(parsed.forkedAt).toBe(1719523200000)
    })

    it('still parses metadata without fork fields (backward compat)', () => {
        expect(() => MetadataSchema.parse({ path: '/tmp', host: 'localhost' })).not.toThrow()
    })
})
