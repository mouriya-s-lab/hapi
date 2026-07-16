import type { SessionSummary } from '@/types/api'

/**
 * Drop sessions the user explicitly archived (metadata.archivedAt set) when the
 * "hide archived sessions" preference is on. Only the explicit archive marker is
 * honored — naturally-ended / timed-out sessions (which have no archivedAt) are
 * always kept. Issue #4.
 */
export function filterVisibleSessions(
    sessions: SessionSummary[],
    hideArchived: boolean
): SessionSummary[] {
    if (!hideArchived) return sessions
    return sessions.filter((session) => session.metadata?.archivedAt == null)
}
