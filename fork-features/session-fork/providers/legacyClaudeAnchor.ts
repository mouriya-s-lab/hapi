import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { getProjectPath } from '../../../cli/src/claude/utils/path'

export async function resolveLegacyClaudeMessageUuid(args: {
    sourceSessionId: string
    sourceCwd: string
    assistantMessageId: string
}): Promise<string> {
    const sessionFile = join(getProjectPath(args.sourceCwd), `${args.sourceSessionId}.jsonl`)
    const input = createReadStream(sessionFile, { encoding: 'utf8' })
    const lines = createInterface({ input, crlfDelay: Infinity })
    let lastMatch: string | undefined

    for await (const line of lines) {
        if (line.trim().length === 0) continue
        const parsed = JSON.parse(line) as unknown
        if (parsed === null || typeof parsed !== 'object') continue
        const record = parsed as { type?: unknown; uuid?: unknown; message?: unknown }
        if (record.type !== 'assistant' || typeof record.uuid !== 'string') continue
        if (record.message === null || typeof record.message !== 'object') continue
        if ((record.message as { id?: unknown }).id === args.assistantMessageId) lastMatch = record.uuid
    }

    if (lastMatch === undefined) {
        throw new Error(`claude legacy anchor: no UUID found for assistant message ${args.assistantMessageId}`)
    }
    return lastMatch
}
