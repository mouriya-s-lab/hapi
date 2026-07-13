import type { RawJSONLines } from '../types'
import type { Session } from '../session'
import { isClaudeChatVisibleMessage } from './chatVisibility'

export function sendClaudeTranscriptMessage(session: Session, message: RawJSONLines): void {
    if (message.type === 'summary' || message.isMeta || message.isCompactSummary || message.isSidechain) return
    if (!isClaudeChatVisibleMessage(message)) return
    session.client.sendClaudeSessionMessage(message)
}
