import type { TranscriptionProvider } from '@hapi/protocol/voice'
import type { TranscriptionCredentialStatus } from '@/api/client'

/** Curated cloud presets shown when onboarding dictation credentials. */
export const DICTATION_PROVIDER_PRESETS = [
    'elevenlabs',
    'openai',
    'groq',
] as const satisfies readonly TranscriptionProvider[]

export type DictationProviderPreset = typeof DICTATION_PROVIDER_PRESETS[number]

/**
 * True when any OpenAI-compatible credential field is stored/configured.
 * Hub status marks `openaiCompatible.configured` only when both base URL and
 * model exist, but the API stores base URL, model, and API key independently
 * — partial entries must stay manageable too.
 */
export function hasOpenAICompatibleCredentials(
    status: TranscriptionCredentialStatus | null | undefined
): boolean {
    if (!status) return false
    return Boolean(
        status.openaiCompatible.baseUrl
        || status.openaiCompatible.model
        || status.openaiCompatible.apiKey.configured
    )
}

/**
 * Providers offered in the dictation credential onboard panel: the curated
 * presets, plus legacy providers that already have hub credentials so
 * existing keys stay rotatable/clearable from the UI.
 */
export function dictationOnboardProviders(
    includeDeepgram: boolean,
    includeOpenAICompatible: boolean
): Array<DictationProviderPreset | 'deepgram' | 'openai-compatible'> {
    return [
        ...DICTATION_PROVIDER_PRESETS,
        ...(includeDeepgram ? ['deepgram' as const] : []),
        ...(includeOpenAICompatible ? ['openai-compatible' as const] : []),
    ]
}
