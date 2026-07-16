import type { RawJSONLines } from '../types'
import type { Session } from '../session'
import { isClaudeChatVisibleMessage } from './chatVisibility'

export function sendClaudeTranscriptMessage(session: Session, message: RawJSONLines): boolean {
    if (message.type === 'summary' || message.isMeta || message.isCompactSummary || message.isSidechain) return false
    if (!isClaudeChatVisibleMessage(message)) return false
    session.client.sendClaudeSessionMessage(message)
    return true
}
