export const CLAUDE_MODEL_LABELS = {
    fable: 'Fable',
    'fable[1m]': 'Fable 1M',
    sonnet: 'Sonnet',
    'sonnet[1m]': 'Sonnet 1M',
    opus: 'Opus',
    'opus[1m]': 'Opus 1M',
    haiku: 'Haiku'
} as const

export type ClaudeModelPreset = keyof typeof CLAUDE_MODEL_LABELS
export const CLAUDE_MODEL_PRESETS = Object.keys(CLAUDE_MODEL_LABELS) as ClaudeModelPreset[]

export const CLAUDE_MODEL_ID_LABELS = {
    'claude-fable-5': 'Fable 5',
    'claude-opus-4-8': 'Opus 4.8',
    'claude-opus-4-7': 'Opus 4.7',
    'claude-opus-4-6': 'Opus 4.6',
    'claude-opus-4-5': 'Opus 4.5',
    'claude-sonnet-5': 'Sonnet 5',
    'claude-sonnet-4-6': 'Sonnet 4.6',
    'claude-haiku-4-5': 'Haiku 4.5'
} as const

export type ClaudeModelId = keyof typeof CLAUDE_MODEL_ID_LABELS
export const CLAUDE_MODEL_IDS = Object.keys(CLAUDE_MODEL_ID_LABELS) as ClaudeModelId[]

export const GEMINI_MODEL_LABELS = {
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview',
    'gemini-3-flash-preview': 'Gemini 3 Flash Preview',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
} as const

export type GeminiModelPreset = keyof typeof GEMINI_MODEL_LABELS
export const GEMINI_MODEL_PRESETS = Object.keys(GEMINI_MODEL_LABELS) as GeminiModelPreset[]
export const DEFAULT_GEMINI_MODEL: GeminiModelPreset = 'gemini-2.5-pro'

export function isClaudeModelPreset(model: string | null | undefined): model is ClaudeModelPreset {
    return typeof model === 'string' && Object.hasOwn(CLAUDE_MODEL_LABELS, model)
}

export function getClaudeModelLabel(model: string): string | null {
    const trimmedModel = model.trim()
    if (!trimmedModel) {
        return null
    }

    return CLAUDE_MODEL_LABELS[trimmedModel as ClaudeModelPreset]
        ?? CLAUDE_MODEL_ID_LABELS[trimmedModel as ClaudeModelId]
        ?? null
}
