export type GrokIdentity =
    | { kind: 'fresh-local'; reservedId: string }
    | { kind: 'fresh-remote' }
    | { kind: 'persisted'; sessionId: string }

export type GrokControl = { kind: 'local' } | { kind: 'remote' }

export type GrokModel =
    | { kind: 'native-default' }
    | { kind: 'explicit'; modelId: string }

export type GrokEffort =
    | { kind: 'native-default' }
    | { kind: 'creation-only'; effortId: 'high' | 'medium' | 'low' }
    | { kind: 'unknown-existing-session' }

export type GrokSessionState = {
    identity: GrokIdentity
    control: GrokControl
    model: GrokModel
    effort: GrokEffort
}

export function createGrokSessionState(input: {
    sessionId?: string
    control: GrokControl
    model?: string
    effort?: string | null
}): GrokSessionState {
    const identity: GrokIdentity = input.sessionId
        ? { kind: 'persisted', sessionId: input.sessionId }
        : { kind: 'fresh-remote' }
    const model: GrokModel = input.model
        ? { kind: 'explicit', modelId: input.model }
        : { kind: 'native-default' }
    const effort: GrokEffort = input.sessionId
        ? { kind: 'unknown-existing-session' }
        : input.effort
            ? { kind: 'creation-only', effortId: parseGrokEffort(input.effort) }
            : { kind: 'native-default' }
    return { identity, control: input.control, model, effort }
}

export function parseGrokEffort(value: string): 'high' | 'medium' | 'low' {
    if (value === 'high' || value === 'medium' || value === 'low') return value
    throw new Error(`Unsupported Grok reasoning effort: ${value}`)
}

export function assertEffortCreationOnly(state: GrokSessionState, requested: unknown): void {
    if (requested !== undefined) {
        throw new Error('Grok reasoning effort can only be selected when creating a new session')
    }
}

export function commitAppliedModel(state: GrokSessionState, modelId: string): GrokSessionState {
    return { ...state, model: { kind: 'explicit', modelId } }
}
