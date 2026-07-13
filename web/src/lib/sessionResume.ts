import { isKnownFlavor, resolveFlavorOwnedAgentSessionId } from '@hapi/protocol'
import type { Session } from '@/types/api'

/** Agent thread id used by hub `resolveAgentResumeId`, flavor-specific.
 *  Mirrors hub: cross-flavor ids are ignored to avoid the web layer claiming a
 *  session is resumable when the hub will only honor the current flavor's id.
 */
export function resolveAgentSessionIdFromMetadata(
    metadata: Session['metadata'] | null | undefined,
): string | undefined {
    if (!metadata) {
        return undefined
    }
    return resolveFlavorOwnedAgentSessionId(metadata)
}

/**
 * Whether an inactive session can be activated via resume (or fresh spawn on first send).
 * Matches hub: resume with agent id, or fresh spawn when path exists, no agent id, no user messages.
 * Claude with messages but no `claudeSessionId` is allowed because hub
 * `recoverClaudeSessionIdFromMessages` reconstructs the resume id from the
 * stored message log (only the claude path has this recovery fallback).
 */
export function inactiveSessionCanResume(
    session: Session,
    userMessageCount: number,
): boolean {
    if (session.active) {
        return true
    }
    if (!session.metadata?.path) {
        return false
    }
    if (resolveAgentSessionIdFromMetadata(session.metadata)) {
        return true
    }
    const flavor = isKnownFlavor(session.metadata.flavor) ? session.metadata.flavor : 'claude'
    if (flavor === 'claude' && userMessageCount > 0) {
        return true
    }
    return userMessageCount === 0
}
