import { afterEach, describe, expect, it } from 'bun:test'
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
            { type: 'user', cwd: '/work/claude', version: '2', message: { content: 'question' } },
            { type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } }
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
        expect(claude[0]).toMatchObject({ externalSessionId: 'claude-id', cwd: '/work/claude', messageCount: 2 })
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
})
