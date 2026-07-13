export function resolveGrokHandoffModel(
    sessionModel: string | null | undefined,
    launchModel: string | undefined
): string | undefined {
    return sessionModel === undefined ? launchModel : sessionModel ?? undefined;
}

export function resolveGrokReasoningEffort(
    model: string | undefined,
    requestedEffort: string | null | undefined
): string | null {
    if (requestedEffort == null) return null;
    if (model !== 'grok-4.5') {
        throw new Error('Grok reasoning effort is only supported for an explicit grok-4.5 session');
    }
    if (requestedEffort !== 'high' && requestedEffort !== 'medium' && requestedEffort !== 'low') {
        throw new Error(`Unsupported Grok reasoning effort: ${requestedEffort}`);
    }
    return requestedEffort;
}
