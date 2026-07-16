import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type { CodexSession } from '../session'
import { convertCodexEvent, type CodexSessionEvent } from './codexEventConverter'

function isSyntheticUserMessage(value: string): boolean {
    const text = value.trimStart()
    return text.startsWith('# AGENTS.md instructions')
        || text.startsWith('<environment_context>')
        || text.startsWith('<user_instructions>')
}

export async function replayCodexTranscriptHistory(path: string, session: CodexSession): Promise<number> {
    const input = createReadStream(path, { encoding: 'utf8' })
    const lines = createInterface({ input, crlfDelay: Infinity })
    let messageCount = 0
    try {
        for await (const line of lines) {
            if (!line.trim()) continue
            const value: unknown = JSON.parse(line)
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Codex transcript line is not an object')
            const record = value as Record<string, unknown>
            if (typeof record.type !== 'string') throw new Error('Codex transcript event has no type')
            const event: CodexSessionEvent = {
                timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
                type: record.type,
                payload: record.payload
            }
            const converted = convertCodexEvent(event)
            if (converted?.userMessage && !isSyntheticUserMessage(converted.userMessage)) { session.sendUserMessage(converted.userMessage); messageCount += 1 }
            if (converted?.message) { session.sendAgentMessage(converted.message); messageCount += 1 }
        }
    } finally {
        lines.close()
        input.destroy()
    }
    return messageCount
}
