import { describe, expect, it } from 'bun:test'
import { SpawnSessionRequestSchema } from './apiTypes'

describe('SpawnSessionRequestSchema Grok capability contract', () => {
    it('rejects reasoning effort for Grok Composer at the API boundary', () => {
        expect(SpawnSessionRequestSchema.safeParse({
            directory: '/project',
            agent: 'grok',
            model: 'grok-composer-2.5-fast',
            modelReasoningEffort: 'medium'
        }).success).toBe(false)
        expect(SpawnSessionRequestSchema.safeParse({
            directory: '/project', agent: 'grok', modelReasoningEffort: 'medium'
        }).success).toBe(false)
        expect(SpawnSessionRequestSchema.safeParse({
            directory: '/project', agent: 'grok', model: 'future-model', modelReasoningEffort: 'medium'
        }).success).toBe(false)
    })

    it('accepts reasoning effort for Grok 4.5', () => {
        expect(SpawnSessionRequestSchema.safeParse({
            directory: '/project',
            agent: 'grok',
            model: 'grok-4.5',
            modelReasoningEffort: 'medium'
        }).success).toBe(true)
    })
})
