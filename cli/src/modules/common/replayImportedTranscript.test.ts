import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiSessionClient } from '@/api/apiSession'
import { replayImportedTranscript } from './replayImportedTranscript'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function file(rows: unknown[]): string {
    const root = mkdtempSync(join(tmpdir(), 'hapi-replay-'))
    roots.push(root)
    const path = join(root, 'session.jsonl')
    writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
    return path
}

describe('replayImportedTranscript', () => {
    it('replays modern Codex response items once and ignores duplicate event messages', async () => {
        const users: string[] = []
        const agents: unknown[] = []
        const session = {
            sendUserMessage: (value: string) => users.push(value),
            sendAgentMessage: (value: unknown) => agents.push(value),
            updateMetadata: () => {}
        } as unknown as ApiSessionClient
        const imported = await replayImportedTranscript({
            agent: 'codex', session,
            transcriptPath: file([
                { type: 'event_msg', payload: { type: 'user_message', message: 'duplicate' } },
                { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'question' }] } },
                { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] } }
            ])
        })
        expect(imported).toBe(2)
        expect(users).toEqual(['question'])
        expect(agents).toHaveLength(1)
    })

    it('replays visible Claude messages and skips sidecar records', async () => {
        const messages: unknown[] = []
        const session = { sendClaudeSessionMessage: (value: unknown) => messages.push(value) } as unknown as ApiSessionClient
        const imported = await replayImportedTranscript({
            agent: 'claude', session,
            transcriptPath: file([
                { type: 'file-history-snapshot', snapshot: {} },
                { type: 'summary', summary: 'internal compact summary', leafUuid: 'summary-leaf' },
                { type: 'assistant', uuid: 'meta', parentUuid: null, sessionId: 's1', timestamp: new Date().toISOString(), isMeta: true, message: { role: 'assistant', content: [{ type: 'text', text: 'skill injection' }] } },
                { type: 'assistant', uuid: 'compact', parentUuid: null, sessionId: 's1', timestamp: new Date().toISOString(), isCompactSummary: true, message: { role: 'assistant', content: [{ type: 'text', text: 'compact context' }] } },
                { type: 'user', uuid: 'command', parentUuid: null, sessionId: 's1', timestamp: new Date().toISOString(), message: { role: 'user', content: '<command-message>review</command-message>' } },
                { type: 'user', uuid: 'args', parentUuid: 'command', sessionId: 's1', timestamp: new Date().toISOString(), message: { role: 'user', content: '<command-args>--all</command-args>' } },
                { type: 'user', uuid: 'u1', parentUuid: null, sessionId: 's1', timestamp: new Date().toISOString(), message: { role: 'user', content: 'question' } },
                { type: 'assistant', uuid: 'a1', parentUuid: 'u1', sessionId: 's1', timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: {} }] } },
                { type: 'user', uuid: 'result', parentUuid: 'a1', sessionId: 's1', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' }] } }
            ])
        })
        expect(imported).toBe(3)
        expect(messages).toHaveLength(3)
    })

    it('replays legacy Codex event messages when no modern chat records exist', async () => {
        const users: string[] = []
        const agents: unknown[] = []
        const session = {
            sendUserMessage: (value: string) => users.push(value),
            sendAgentMessage: (value: unknown) => agents.push(value),
            updateMetadata: () => {}
        } as unknown as ApiSessionClient
        const imported = await replayImportedTranscript({
            agent: 'codex', session,
            transcriptPath: file([
                { type: 'event_msg', payload: { type: 'user_message', message: 'legacy question' } },
                { type: 'event_msg', payload: { type: 'agent_message', message: 'legacy answer' } }
            ])
        })
        expect(imported).toBe(2)
        expect(users).toEqual(['legacy question'])
        expect(agents).toHaveLength(1)
    })
})
