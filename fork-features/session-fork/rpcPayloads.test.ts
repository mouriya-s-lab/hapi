import { describe, it, expect } from 'bun:test'
import { ForkSpawnPayloadSchema, ForkSpawnResultSchema } from './rpcPayloads'

describe('rpcPayloads', () => {
    it('parses ForkSpawnPayload with required fields', () => {
        const payload = ForkSpawnPayloadSchema.parse({
            sourceMetadata: { path: '/work', host: 'localhost', claudeSessionId: 'abc' },
            sourceCwd: '/tmp/work'
        })
        expect(payload.sourceCwd).toBe('/tmp/work')
        expect(payload.sourceMetadata.claudeSessionId).toBe('abc')
    })

    it('parses ForkSpawnPayload with optional source-state fields', () => {
        const payload = ForkSpawnPayloadSchema.parse({
            sourceMetadata: { path: '/w', host: 'h' },
            sourceCwd: '/w',
            sourceModel: 'claude-opus-4-8',
            sourcePermissionMode: 'default',
            sourceCollaborationMode: 'plan'
        })
        expect(payload.sourceModel).toBe('claude-opus-4-8')
        expect(payload.sourcePermissionMode).toBe('default')
        expect(payload.sourceCollaborationMode).toBe('plan')
    })

    it('parses ForkSpawnResult', () => {
        const result = ForkSpawnResultSchema.parse({
            providerSessionId: 'new-claude-id',
            metadataPatch: { claudeSessionId: 'new-claude-id' }
        })
        expect(result.providerSessionId).toBe('new-claude-id')
        expect(result.metadataPatch.claudeSessionId).toBe('new-claude-id')
    })

    it('rejects ForkSpawnPayload without required fields', () => {
        expect(() => ForkSpawnPayloadSchema.parse({})).toThrow()
        expect(() => ForkSpawnPayloadSchema.parse({ sourceCwd: '/w' })).toThrow()
    })

    it('parses ForkSpawnPayload with forkPoint (per-message fork)', () => {
        const payload = ForkSpawnPayloadSchema.parse({
            sourceMetadata: { path: '/w', host: 'h' },
            sourceCwd: '/w',
            forkPoint: { messageId: 'm-42', tailOffset: 3 }
        })
        expect(payload.forkPoint).toEqual({ messageId: 'm-42', tailOffset: 3 })
    })

    it('parses ForkSpawnPayload without forkPoint (HEAD fork, backward-compat)', () => {
        const payload = ForkSpawnPayloadSchema.parse({
            sourceMetadata: { path: '/w', host: 'h' },
            sourceCwd: '/w'
        })
        expect(payload.forkPoint).toBeUndefined()
    })

    it('rejects forkPoint with missing tailOffset', () => {
        expect(() =>
            ForkSpawnPayloadSchema.parse({
                sourceMetadata: { path: '/w', host: 'h' },
                sourceCwd: '/w',
                forkPoint: { messageId: 'm-42' }
            })
        ).toThrow()
    })

    it('rejects forkPoint with negative tailOffset', () => {
        expect(() =>
            ForkSpawnPayloadSchema.parse({
                sourceMetadata: { path: '/w', host: 'h' },
                sourceCwd: '/w',
                forkPoint: { messageId: 'm-42', tailOffset: -1 }
            })
        ).toThrow()
    })

    it('rejects forkPoint with non-integer tailOffset', () => {
        expect(() =>
            ForkSpawnPayloadSchema.parse({
                sourceMetadata: { path: '/w', host: 'h' },
                sourceCwd: '/w',
                forkPoint: { messageId: 'm-42', tailOffset: 1.5 }
            })
        ).toThrow()
    })
})
