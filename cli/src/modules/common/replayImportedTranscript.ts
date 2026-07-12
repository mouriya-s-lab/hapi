import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type { ApiSessionClient } from '@/api/apiSession'
import { RawJSONLinesSchema } from '@/claude/types'
import { isClaudeChatVisibleMessage } from '@/claude/utils/chatVisibility'
import { convertCodexEvent, type CodexSessionEvent } from '@/codex/utils/codexEventConverter'
import type { ImportableSessionAgent } from '@hapi/protocol/apiTypes'
import { isSyntheticCodexUserText, realClaudeUserText } from './importableSessions'

function hasClaudeToolResult(message: { message?: { content: unknown } }): boolean {
    return Array.isArray(message.message?.content) && message.message.content.some((block) => (
        block !== null && typeof block === 'object' && !Array.isArray(block)
        && (block as Record<string, unknown>).type === 'tool_result'
    ))
}

async function hasModernCodexChat(transcriptPath: string): Promise<boolean> {
    const input = createReadStream(transcriptPath, { encoding: 'utf8' })
    const lines = createInterface({ input, crlfDelay: Infinity })
    try {
        for await (const line of lines) {
            if (!line.trim()) continue
            const parsed = JSON.parse(line) as unknown
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue
            const record = parsed as Record<string, unknown>
            if (record.type !== 'response_item' || record.payload === null || typeof record.payload !== 'object' || Array.isArray(record.payload)) continue
            const converted = convertCodexEvent({ type: 'response_item', payload: record.payload })
            if (converted?.message) return true
            if (converted?.userMessage && !isSyntheticCodexUserText(converted.userMessage)) return true
        }
        return false
    } finally {
        lines.close()
        input.destroy()
    }
}

export async function replayImportedTranscript(options: {
    agent: ImportableSessionAgent
    transcriptPath: string
    session: ApiSessionClient
}): Promise<number> {
    const useLegacyCodexChat = options.agent === 'codex' && !await hasModernCodexChat(options.transcriptPath)
    const input = createReadStream(options.transcriptPath, { encoding: 'utf8' })
    const lines = createInterface({ input, crlfDelay: Infinity })
    let imported = 0
    try {
        for await (const line of lines) {
            if (!line.trim()) continue
            const parsed = JSON.parse(line) as unknown
            if (options.agent === 'claude') {
                const result = RawJSONLinesSchema.safeParse(parsed)
                if (!result.success) {
                    const raw = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
                    if (raw?.type === 'user' || raw?.type === 'assistant' || raw?.type === 'system') throw result.error
                    continue
                }
                const message = result.data
                if (message.type === 'summary' || message.isMeta || message.isCompactSummary) continue
                if (!isClaudeChatVisibleMessage(message)) continue
                if (message.type === 'user') {
                    if (message.isSidechain) continue
                    if (!hasClaudeToolResult(message) && realClaudeUserText(message) === null) continue
                }
                options.session.sendClaudeSessionMessage(message)
                imported += 1
                continue
            }
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('Codex transcript line is not an object')
            }
            const record = parsed as Record<string, unknown>
            if (typeof record.type !== 'string') throw new Error('Codex transcript line has no type')
            if (record.type !== 'response_item' && !(useLegacyCodexChat && record.type === 'event_msg')) continue
            const event: CodexSessionEvent = {
                timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
                type: record.type,
                payload: record.payload
            }
            const converted = convertCodexEvent(event)
            if (converted?.sessionId) options.session.updateMetadata((metadata) => ({ ...metadata, codexSessionId: converted.sessionId }))
            if (converted?.userMessage) {
                if (!isSyntheticCodexUserText(converted.userMessage)) {
                    options.session.sendUserMessage(converted.userMessage)
                    imported += 1
                }
            }
            if (converted?.message) {
                options.session.sendAgentMessage(converted.message)
                imported += 1
            }
        }
    } finally {
        lines.close()
        input.destroy()
    }
    return imported
}
