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

    it('accepts a pending deferred Claude launch recipe', () => {
        const parsed = MetadataSchema.parse({
            path: '/work',
            host: 'localhost',
            pendingClaudeLaunch: {
                resumeSessionId: 'new-session-id',
                launch: {
                    type: 'resume-at',
                    sourceSessionId: 'source-session-id',
                    providerMessageId: 'provider-message-id'
                }
            }
        })
        expect(parsed.pendingClaudeLaunch?.resumeSessionId).toBe('new-session-id')
    })
})

describe('OMP native session metadata', () => {
    it('parses one authoritative id/file/name snapshot', () => {
        const parsed = MetadataSchema.parse({
            path: '/work',
            host: 'host',
            ompSession: {
                id: 'omp-id',
                file: '/sessions/omp-id.jsonl',
                name: 'OMP title'
            }
        })
        expect(parsed.ompSession).toEqual({
            id: 'omp-id',
            file: '/sessions/omp-id.jsonl',
            name: 'OMP title'
        })
    })

    it('rejects a partial snapshot without sessionFile', () => {
        expect(() => MetadataSchema.parse({
            path: '/work',
            host: 'host',
            ompSession: { id: 'omp-id' }
        })).toThrow()
    })
})
