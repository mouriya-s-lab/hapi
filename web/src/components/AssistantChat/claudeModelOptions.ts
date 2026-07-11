import { CLAUDE_MODEL_IDS, CLAUDE_MODEL_PRESETS, getClaudeModelLabel } from '@hapi/protocol'

export type ClaudeComposerModelOption = {
    value: string | null
    label: string
}

const CLAUDE_SELECTABLE_MODELS: readonly string[] = [...CLAUDE_MODEL_PRESETS, ...CLAUDE_MODEL_IDS]

export function isListedClaudeModel(model?: string | null): boolean {
    const normalizedModel = normalizeClaudeComposerModel(model)
    return normalizedModel !== null && CLAUDE_SELECTABLE_MODELS.includes(normalizedModel)
}

export function normalizeCustomClaudeModelId(value: string): string | null {
    const modelId = value.trim()
    return modelId || null
}

function normalizeClaudeComposerModel(model?: string | null): string | null {
    const trimmedModel = model?.trim()
    if (!trimmedModel || trimmedModel === 'auto' || trimmedModel === 'default') {
        return null
    }

    return trimmedModel
}

export function getClaudeComposerModelOptions(currentModel?: string | null): ClaudeComposerModelOption[] {
    const options: ClaudeComposerModelOption[] = [
        { value: null, label: 'Default' }
    ]

    options.push(...CLAUDE_SELECTABLE_MODELS.map((model) => ({
        value: model,
        label: getClaudeModelLabel(model) ?? model
    })))

    return options
}

export function getNextClaudeComposerModel(currentModel?: string | null): string | null {
    const normalizedCurrentModel = normalizeClaudeComposerModel(currentModel)
    const options = getClaudeComposerModelOptions(normalizedCurrentModel)
    const currentIndex = options.findIndex((option) => option.value === normalizedCurrentModel)

    if (currentIndex === -1) {
        return options[0]?.value ?? null
    }

    return options[(currentIndex + 1) % options.length]?.value ?? null
}
