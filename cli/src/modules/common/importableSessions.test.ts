import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { listImportableSessions } from './importableSessions'

const originalClaude = process.env.CLAUDE_CONFIG_DIR
const originalCodex = process.env.CODEX_HOME
const roots: string[] = []

function setup(): string {
    const root = mkdtempSync(join(tmpdir(), 'hapi-stream-index-'))
    roots.push(root)
    process.env.CLAUDE_CONFIG_DIR = join(root, 'claude')
    process.env.CODEX_HOME = join(root, 'codex')
    return root
}

function transcript(path: string, rows: unknown[]): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
}

afterEach(() => {
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
    if (originalClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaude
    if (originalCodex === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = originalCodex
})

describe('streaming importable session index', () => {
    it('indexes Claude and Codex transcripts without returning local paths', async () => {
        const root = setup()
        transcript(join(root, 'claude/projects/p/claude-id.jsonl'), [
            { type: 'user', uuid: 'u1', cwd: '/work/claude', version: '2', message: { content: 'question' } },
            { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'answer' }] } },
            { type: 'assistant', uuid: 'meta', isMeta: true, message: { content: [{ type: 'text', text: 'internal' }] } },
            { type: 'user', uuid: 'command', message: { content: '<command-message>review</command-message>' } },
            { type: 'user', uuid: 'result', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'result' }] } }
        ])
        transcript(join(root, 'codex/sessions/2026/07/12/rollout.jsonl'), [
            { type: 'session_meta', payload: { id: 'codex-id', cwd: '/work/codex', cli_version: '1' } },
            { type: 'event_msg', payload: { type: 'user_message', message: 'duplicate event' } },
            { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'codex question' }] } },
            { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'codex answer' }] } }
        ])

        const claude = (await listImportableSessions({ agent: 'claude' })).sessions
        const codex = (await listImportableSessions({ agent: 'codex' })).sessions
        expect(claude).toHaveLength(1)
        expect(claude[0]).toMatchObject({ externalSessionId: 'claude-id', cwd: '/work/claude', messageCount: 3 })
        expect(codex).toHaveLength(1)
        expect(codex[0]).toMatchObject({ externalSessionId: 'codex-id', cwd: '/work/codex', previewPrompt: 'codex question', messageCount: 2 })
        expect(JSON.stringify([...claude, ...codex])).not.toContain(root)
    })

    it('excludes Codex subagent transcripts', async () => {
        const root = setup()
        transcript(join(root, 'codex/sessions/child.jsonl'), [
            { type: 'session_meta', payload: { id: 'child', cwd: '/work', source: { subagent: { parent_thread_id: 'root' } } } },
            { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'child' }] } }
        ])
        expect((await listImportableSessions({ agent: 'codex' })).sessions).toEqual([])
    })

    it('indexes legacy Codex transcripts that only contain event messages', async () => {
        const root = setup()
        transcript(join(root, 'codex/sessions/legacy.jsonl'), [
            { type: 'session_meta', payload: { id: 'legacy', cwd: '/work/legacy' } },
            { type: 'event_msg', payload: { type: 'user_message', message: 'legacy question' } },
            { type: 'event_msg', payload: { type: 'agent_message', message: 'legacy answer' } }
        ])
        expect((await listImportableSessions({ agent: 'codex' })).sessions[0]).toMatchObject({
            externalSessionId: 'legacy', previewPrompt: 'legacy question', messageCount: 2
        })
    })

    it('isolates a malformed transcript without hiding valid sessions', async () => {
        const root = setup()
        const malformed = join(root, 'codex/sessions/malformed.jsonl')
        mkdirSync(dirname(malformed), { recursive: true })
        writeFileSync(malformed, '{"type":"session_meta"\n')
        transcript(join(root, 'codex/sessions/valid.jsonl'), [
            { type: 'session_meta', payload: { id: 'valid', cwd: '/work/valid' } },
            { type: 'event_msg', payload: { type: 'user_message', message: 'question' } }
        ])

        expect((await listImportableSessions({ agent: 'codex' })).sessions).toEqual([
            expect.objectContaining({ externalSessionId: 'valid' })
        ])
    })

    it('reuses a stable file snapshot across cursor pages', async () => {
        const root = setup()
        for (let index = 0; index < 51; index += 1) {
            transcript(join(root, `codex/sessions/${index}.jsonl`), [
                { type: 'session_meta', payload: { id: `session-${index}`, cwd: '/work' } },
                { type: 'event_msg', payload: { type: 'user_message', message: `question ${index}` } }
            ])
        }
        const first = await listImportableSessions({ agent: 'codex' })
        expect(first.sessions).toHaveLength(50)
        expect(first.nextCursor).not.toBeNull()
        const independent = await listImportableSessions({ agent: 'codex' })
        expect(independent.nextCursor).not.toBe(first.nextCursor)

        transcript(join(root, 'codex/sessions/added-after-page-one.jsonl'), [
            { type: 'session_meta', payload: { id: 'added-later', cwd: '/work' } },
            { type: 'event_msg', payload: { type: 'user_message', message: 'later' } }
        ])
        const second = await listImportableSessions({ agent: 'codex', cursor: first.nextCursor! })
        expect(second.sessions).toHaveLength(1)
        expect(second.sessions[0].externalSessionId).not.toBe('added-later')
        expect(second.nextCursor).toBeNull()
    })

    it('infers a legacy Codex session id from its filename', async () => {
        const root = setup()
        const id = '11111111-2222-4333-8444-555555555555'
        transcript(join(root, `codex/sessions/rollout-${id}.jsonl`), [
            { type: 'event_msg', cwd: '/work/legacy', payload: { type: 'user_message', message: 'legacy question' } }
        ])
        expect((await listImportableSessions({ agent: 'codex' })).sessions[0]).toMatchObject({
            externalSessionId: id, previewPrompt: 'legacy question'
        })
    })
})
