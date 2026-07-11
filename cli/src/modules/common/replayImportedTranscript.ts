import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type { ApiSessionClient } from '@/api/apiSession'
import { RawJSONLinesSchema } from '@/claude/types'
import { isClaudeChatVisibleMessage } from '@/claude/utils/chatVisibility'
import { convertCodexEvent, type CodexSessionEvent } from '@/codex/utils/codexEventConverter'
import type { ImportableSessionAgent } from '@hapi/protocol/apiTypes'

export async function replayImportedTranscript(options: {
    agent: ImportableSessionAgent
    transcriptPath: string
    session: ApiSessionClient
}): Promise<number> {
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
                if (!isClaudeChatVisibleMessage(message)) continue
                options.session.sendClaudeSessionMessage(message)
                imported += 1
                continue
            }
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('Codex transcript line is not an object')
            }
            const record = parsed as Record<string, unknown>
            if (typeof record.type !== 'string') throw new Error('Codex transcript line has no type')
            if (record.type !== 'response_item') continue
            const event: CodexSessionEvent = {
                timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
                type: record.type,
                payload: record.payload
            }
            const converted = convertCodexEvent(event)
            if (converted?.sessionId) options.session.updateMetadata((metadata) => ({ ...metadata, codexSessionId: converted.sessionId }))
            if (converted?.userMessage) {
                options.session.sendUserMessage(converted.userMessage)
                imported += 1
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
