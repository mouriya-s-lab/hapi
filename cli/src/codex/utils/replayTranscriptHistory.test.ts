import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { replayCodexTranscriptHistory } from './replayTranscriptHistory'
import type { CodexSession } from '../session'

describe('replayCodexTranscriptHistory', () => {
    const directory = join(tmpdir(), `codex-history-${process.pid}`)
    afterEach(async () => rm(directory, { recursive: true, force: true }))

    it('uses canonical response items and excludes synthetic user context', async () => {
        await mkdir(directory, { recursive: true })
        const path = join(directory, 'session.jsonl')
        await writeFile(path, [
            JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'real prompt' } }),
            JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: '# AGENTS.md instructions\ninternal' } }),
            JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'answer' } }),
            JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'duplicate model state' }] } })
        ].join('\n') + '\n')
        const users: string[] = []
        const agents: unknown[] = []
        const session = {
            sendUserMessage: (value: string) => users.push(value),
            sendAgentMessage: (value: unknown) => agents.push(value)
        } as unknown as CodexSession

        await replayCodexTranscriptHistory(path, session)

        expect(users).toEqual(['real prompt'])
        expect(agents).toHaveLength(1)
    })
})
