import {
    getCodexEventTurnId,
    type CodexSessionEvent
} from '../../cli/src/codex/utils/codexEventConverter'

export type CodexCompactSummaryTurnOwnership = {
    recordOwnedTurn: (turnId: string) => void
    expectOwnedCompact: () => void
    clearExpectedOwnedCompact: () => void
    observeTranscriptEvent: (event: CodexSessionEvent) => boolean
    getTranscriptTurnId: () => string | null
}

export function createCodexCompactSummaryTurnOwnership(): CodexCompactSummaryTurnOwnership {
    const ownedTurnIds = new Set<string>()
    let transcriptTurnId: string | null = null
    let expectedOwnedCompact = false

    return {
        recordOwnedTurn(turnId) {
            ownedTurnIds.add(turnId)
        },
        expectOwnedCompact() {
            expectedOwnedCompact = true
        },
        clearExpectedOwnedCompact() {
            expectedOwnedCompact = false
        },
        observeTranscriptEvent(event) {
            transcriptTurnId = getCodexEventTurnId(event) ?? transcriptTurnId
            if (event.type !== 'compacted') {
                return true
            }
            const isOwned = expectedOwnedCompact
                || (transcriptTurnId !== null && ownedTurnIds.has(transcriptTurnId))
            expectedOwnedCompact = false
            return isOwned
        },
        getTranscriptTurnId() {
            return transcriptTurnId
        }
    }
}
