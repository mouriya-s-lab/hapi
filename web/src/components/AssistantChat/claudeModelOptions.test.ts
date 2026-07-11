import { describe, expect, it } from 'vitest'
import { getClaudeComposerModelOptions, getNextClaudeComposerModel, normalizeCustomClaudeModelId } from './claudeModelOptions'

const SPECIFIC_MODEL_IDS = [
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-opus-4-5',
    'claude-sonnet-5',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
]

const SPECIFIC_MODEL_OPTIONS = [
    { value: 'claude-fable-5', label: 'Fable 5' },
    { value: 'claude-opus-4-8', label: 'Opus 4.8' },
    { value: 'claude-opus-4-7', label: 'Opus 4.7' },
    { value: 'claude-opus-4-6', label: 'Opus 4.6' },
    { value: 'claude-opus-4-5', label: 'Opus 4.5' },
    { value: 'claude-sonnet-5', label: 'Sonnet 5' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
    { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
]

describe('getClaudeComposerModelOptions', () => {
    it('includes the active non-preset Claude model in the options list', () => {
        expect(getClaudeComposerModelOptions('claude-opus-4-1-20250805')).toEqual([
            { value: null, label: 'Default' },
            { value: 'claude-opus-4-1-20250805', label: 'claude-opus-4-1-20250805' },
            { value: 'fable', label: 'Fable' },
            { value: 'fable[1m]', label: 'Fable 1M' },
            { value: 'sonnet', label: 'Sonnet' },
            { value: 'sonnet[1m]', label: 'Sonnet 1M' },
            { value: 'opus', label: 'Opus' },
            { value: 'opus[1m]', label: 'Opus 1M' },
            { value: 'haiku', label: 'Haiku' },
            ...SPECIFIC_MODEL_OPTIONS,
        ])
    })

    it('does not duplicate preset Claude models', () => {
        expect(getClaudeComposerModelOptions('opus')).toEqual([
            { value: null, label: 'Default' },
            { value: 'fable', label: 'Fable' },
            { value: 'fable[1m]', label: 'Fable 1M' },
            { value: 'sonnet', label: 'Sonnet' },
            { value: 'sonnet[1m]', label: 'Sonnet 1M' },
            { value: 'opus', label: 'Opus' },
            { value: 'opus[1m]', label: 'Opus 1M' },
            { value: 'haiku', label: 'Haiku' },
            ...SPECIFIC_MODEL_OPTIONS,
        ])
    })

    it('includes every specific model id once and preserves a custom model id', () => {
        const customModelId = 'vendor-claude-ultra'
        const options = getClaudeComposerModelOptions(customModelId)
        expect(options[1]).toEqual({ value: customModelId, label: customModelId })
        for (const modelId of SPECIFIC_MODEL_IDS) {
            expect(options.filter((option) => option.value === modelId)).toHaveLength(1)
        }
    })
})

describe('getNextClaudeComposerModel', () => {
    it('cycles from a non-preset Claude model to the next selectable model instead of auto', () => {
        expect(getNextClaudeComposerModel('claude-opus-4-1-20250805')).toBe('fable')
    })

    it('cycles from the final specific model id to Default', () => {
        expect(getNextClaudeComposerModel('claude-haiku-4-5')).toBeNull()
    })
})

describe('normalizeCustomClaudeModelId', () => {
    it('passes a provider model id through after trimming surrounding whitespace', () => {
        expect(normalizeCustomClaudeModelId('  vendor-claude-ultra  ')).toBe('vendor-claude-ultra')
    })

    it('rejects an empty custom model id', () => {
        expect(normalizeCustomClaudeModelId('   ')).toBeNull()
    })
})
