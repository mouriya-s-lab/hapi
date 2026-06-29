import { describe, it, expect } from 'bun:test'
import { ForkSpawnPayloadSchema, ForkSpawnResultSchema } from './rpcPayloads'

describe('rpcPayloads', () => {
    it('parses ForkSpawnPayload with required fields', () => {
        const payload = ForkSpawnPayloadSchema.parse({
            sourceMetadata: { path: '/work', host: 'localhost', claudeSessionId: 'abc' },
            sourceCwd: '/tmp/work',
            newHapiSessionId: 'new-id'
        })
        expect(payload.sourceCwd).toBe('/tmp/work')
        expect(payload.sourceMetadata.claudeSessionId).toBe('abc')
        expect(payload.newHapiSessionId).toBe('new-id')
    })

    it('parses ForkSpawnPayload with optional source-state fields', () => {
        const payload = ForkSpawnPayloadSchema.parse({
            sourceMetadata: { path: '/w', host: 'h' },
            sourceCwd: '/w',
            sourceModel: 'claude-opus-4-8',
            sourcePermissionMode: 'default',
            sourceCollaborationMode: 'plan',
            newHapiSessionId: 'n'
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
        expect(() => ForkSpawnPayloadSchema.parse({ sourceMetadata: { path: '/p', host: 'h' } })).toThrow()
    })
})
