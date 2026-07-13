import { describe, expect, it } from 'vitest'
import { assertEffortCreationOnly, commitAppliedModel, createGrokSessionState } from './sessionController'

describe('GrokSessionController state', () => {
    it('marks effort as creation-only for a fresh session', () => {
        expect(createGrokSessionState({ control: { kind: 'remote' }, model: 'grok-4.5', effort: 'medium' })).toEqual({
            identity: { kind: 'fresh-remote' },
            control: { kind: 'remote' },
            model: { kind: 'explicit', modelId: 'grok-4.5' },
            effort: { kind: 'creation-only', effortId: 'medium' }
        })
    })

    it('does not claim the effort of an imported session', () => {
        expect(createGrokSessionState({ sessionId: 'persisted', control: { kind: 'local' }, effort: 'high' }).effort)
            .toEqual({ kind: 'unknown-existing-session' })
    })

    it('rejects active effort mutation and commits a model only after success', () => {
        const state = createGrokSessionState({ control: { kind: 'remote' } })
        expect(() => assertEffortCreationOnly(state, 'low')).toThrow('only be selected when creating')
        expect(commitAppliedModel(state, 'grok-composer-2.5-fast').model)
            .toEqual({ kind: 'explicit', modelId: 'grok-composer-2.5-fast' })
    })
})
