import { describe, expect, it } from 'vitest'
import { getClaudeComposerModelOptions, getNextClaudeComposerModel } from './claudeModelOptions'

const PRESET_OPTIONS = [
    { value: 'fable', label: 'Fable' },
    { value: 'fable[1m]', label: 'Fable 1M' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'sonnet[1m]', label: 'Sonnet 1M' },
    { value: 'opus', label: 'Opus' },
    { value: 'opus[1m]', label: 'Opus 1M' },
    { value: 'haiku', label: 'Haiku' },
]

const MODEL_ID_OPTIONS = [
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
            ...PRESET_OPTIONS,
            ...MODEL_ID_OPTIONS,
        ])
    })

    it('does not duplicate preset Claude models', () => {
        expect(getClaudeComposerModelOptions('opus')).toEqual([
            { value: null, label: 'Default' },
            ...PRESET_OPTIONS,
            ...MODEL_ID_OPTIONS,
        ])
    })

    it('does not duplicate specific Claude model ids', () => {
        const options = getClaudeComposerModelOptions('claude-opus-4-7')
        expect(options.filter((option) => option.value === 'claude-opus-4-7')).toHaveLength(1)
        expect(options).toEqual([
            { value: null, label: 'Default' },
            ...PRESET_OPTIONS,
            ...MODEL_ID_OPTIONS,
        ])
    })
})

describe('getNextClaudeComposerModel', () => {
    it('cycles from a non-preset Claude model to the next selectable model instead of auto', () => {
        expect(getNextClaudeComposerModel('claude-opus-4-1-20250805')).toBe('fable')
    })

    it('cycles from the last specific model id back to Default', () => {
        expect(getNextClaudeComposerModel('claude-haiku-4-5')).toBeNull()
    })
})
