export const OMP_EFFORT_LEVELS = [
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
] as const

export const OMP_THINKING_LEVELS = [
    'inherit',
    'off',
    ...OMP_EFFORT_LEVELS
] as const

export type OmpEffort = (typeof OMP_EFFORT_LEVELS)[number]
export type OmpThinkingLevel = (typeof OMP_THINKING_LEVELS)[number]
export type OmpConfiguredThinkingLevel = OmpThinkingLevel | 'auto'

/**
 * OMP exposes three distinct thinking values. `configured` is the durable
 * user selector, `thinkingLevel` is the currently effective level, and
 * `resolved` is populated only when `auto` classifies a concrete turn.
 */
export type OmpThinkingState = {
    thinkingLevel: OmpThinkingLevel | null
    configured: OmpConfiguredThinkingLevel | null
    resolved: OmpEffort | null
}
