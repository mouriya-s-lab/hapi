import { describe, it, expect } from 'bun:test'
import { MetadataSchema } from '../../shared/src/schemas'

/**
 * Cover the fork-lineage fields fork-features adds/edits on the upstream
 * MetadataSchema (trunk patch #1): `forkedFrom`, `forkedAt`,
 * `forkedFromMessageId`. Kept under fork-features so schema-side edits
 * don't leak test edits into upstream test files.
 */
describe('MetadataSchema fork lineage fields', () => {
    const base = { path: '/tmp', host: 'test' }

    it('accepts full lineage triple: forkedFrom + forkedAt + forkedFromMessageId', () => {
        const parsed = MetadataSchema.safeParse({
            ...base,
            forkedFrom: 'src-session',
            forkedAt: 1_700_000_000,
            forkedFromMessageId: 'msg-42'
        })
        expect(parsed.success).toBe(true)
        if (parsed.success) {
            expect(parsed.data.forkedFromMessageId).toBe('msg-42')
            expect(parsed.data.forkedFrom).toBe('src-session')
            expect(parsed.data.forkedAt).toBe(1_700_000_000)
        }
    })

    it('accepts HEAD-fork lineage (no forkedFromMessageId — backward-compat with #55)', () => {
        const parsed = MetadataSchema.safeParse({
            ...base,
            forkedFrom: 'src-session',
            forkedAt: 1_700_000_000
        })
        expect(parsed.success).toBe(true)
        if (parsed.success) {
            expect(parsed.data.forkedFromMessageId).toBeUndefined()
        }
    })

    it('accepts metadata without any fork lineage (non-forked session)', () => {
        const parsed = MetadataSchema.safeParse(base)
        expect(parsed.success).toBe(true)
    })

    it('rejects non-string forkedFromMessageId', () => {
        const parsed = MetadataSchema.safeParse({
            ...base,
            forkedFromMessageId: 42 as unknown as string
        })
        expect(parsed.success).toBe(false)
    })
})
