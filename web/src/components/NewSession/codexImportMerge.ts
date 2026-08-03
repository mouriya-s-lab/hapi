export function resolveCodexImportRedirectSessionId(
    merged: ReadonlyArray<{ canonicalSessionId?: string | null }>,
    importedHapiSessionIds: readonly string[]
): string | null {
    return merged.find((group) => Boolean(group.canonicalSessionId))?.canonicalSessionId
        ?? importedHapiSessionIds[0]
        ?? null
}

export function clearBatchImportedCodexSelection(
    selectedSessionId: string | null,
    importedSessionIds: string[]
): string | null {
    return selectedSessionId && importedSessionIds.includes(selectedSessionId) ? null : selectedSessionId
}
