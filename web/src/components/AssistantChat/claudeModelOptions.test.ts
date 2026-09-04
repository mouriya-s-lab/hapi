import { describe, expect, it } from 'vitest'
import { getClaudeComposerModelOptions, getNextClaudeComposerModel, isListedClaudeModel, normalizeCustomClaudeModelId } from './claudeModelOptions'

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
    it('keeps custom ids out of the listed options because the custom radio owns them', () => {
        expect(getClaudeComposerModelOptions('claude-opus-4-1-20250805')).toEqual([
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

    it('includes every specific model id once', () => {
        const options = getClaudeComposerModelOptions('vendor-claude-ultra')
        for (const modelId of SPECIFIC_MODEL_IDS) {
            expect(options.filter((option) => option.value === modelId)).toHaveLength(1)
        }
    })
})

describe('isListedClaudeModel', () => {
    it('distinguishes listed presets and ids from provider-defined ids', () => {
        expect(isListedClaudeModel('opus')).toBe(true)
        expect(isListedClaudeModel('claude-opus-4-8')).toBe(true)
        expect(isListedClaudeModel('vendor-claude-ultra')).toBe(false)
        expect(isListedClaudeModel(null)).toBe(false)
    })
})

describe('getNextClaudeComposerModel', () => {
    it('cycles from a custom Claude model to Default', () => {
        expect(getNextClaudeComposerModel('claude-opus-4-1-20250805')).toBeNull()
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
