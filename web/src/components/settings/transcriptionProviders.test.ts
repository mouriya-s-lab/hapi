import { describe, expect, test } from 'vitest'
import { DICTATION_PROVIDER_PRESETS, dictationOnboardProviders, hasOpenAICompatibleCredentials } from './transcriptionProviders'
import type { TranscriptionCredentialStatus } from '@/api/client'

describe('dictation provider presets', () => {
    test('offers the supported hosted presets in the intended order', () => {
        expect(DICTATION_PROVIDER_PRESETS).toEqual(['elevenlabs', 'openai', 'groq'])
    })
})

describe('dictationOnboardProviders', () => {
    test('shows only the curated presets when no legacy credentials exist', () => {
        expect(dictationOnboardProviders(false, false)).toEqual(['elevenlabs', 'openai', 'groq'])
    })

    test('keeps legacy providers manageable once their credentials exist', () => {
        expect(dictationOnboardProviders(true, true)).toEqual([
            'elevenlabs',
            'openai',
            'groq',
            'deepgram',
            'openai-compatible',
        ])
        expect(dictationOnboardProviders(true, false)).toEqual([
            'elevenlabs',
            'openai',
            'groq',
            'deepgram',
        ])
    })
})

describe('hasOpenAICompatibleCredentials', () => {
    const base = {
        openai: { configured: false, source: 'none' as const, hint: null, editable: true },
        elevenlabs: { configured: false, source: 'none' as const, hint: null, editable: true },
        deepgram: { configured: false, source: 'none' as const, hint: null, editable: true },
        groq: { configured: false, source: 'none' as const, hint: null, editable: true },
        openaiCompatible: {
            configured: false,
            source: 'none' as const,
            baseUrl: null,
            model: null,
            baseUrlEditable: true,
            modelEditable: true,
            apiKey: { configured: false, source: 'none' as const, hint: null, editable: true },
        },
        voiceBackends: {
            elevenlabs: { configured: false, source: 'none' as const, hint: null, editable: true },
            geminiLive: { configured: false, source: 'none' as const, hint: null, editable: true },
            qwenRealtime: { configured: false, source: 'none' as const, hint: null, editable: true },
        },
    } satisfies TranscriptionCredentialStatus

    test('is false when no OpenAI-compatible field is present', () => {
        expect(hasOpenAICompatibleCredentials(base)).toBe(false)
        expect(hasOpenAICompatibleCredentials(null)).toBe(false)
        expect(hasOpenAICompatibleCredentials(undefined)).toBe(false)
    })

    test('is true for api-key-only, base-url-only, and model-only partial entries', () => {
        expect(hasOpenAICompatibleCredentials({
            ...base,
            openaiCompatible: { ...base.openaiCompatible, apiKey: { ...base.openaiCompatible.apiKey, configured: true } },
        })).toBe(true)
        expect(hasOpenAICompatibleCredentials({
            ...base,
            openaiCompatible: { ...base.openaiCompatible, baseUrl: 'http://127.0.0.1:8000/v1' },
        })).toBe(true)
        expect(hasOpenAICompatibleCredentials({
            ...base,
            openaiCompatible: { ...base.openaiCompatible, model: 'whisper-large-v3' },
        })).toBe(true)
        expect(hasOpenAICompatibleCredentials({
            ...base,
            openaiCompatible: { ...base.openaiCompatible, configured: true, baseUrl: 'http://127.0.0.1:8000/v1', model: 'whisper-large-v3' },
        })).toBe(true)
    })
})
