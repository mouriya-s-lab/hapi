import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getProjectPath } from '../../../cli/src/claude/utils/path'
import { resolveLegacyClaudeMessageUuid } from './legacyClaudeAnchor'

let root: string | undefined

afterEach(async () => {
    delete process.env.CLAUDE_CONFIG_DIR
    if (root) await rm(root, { recursive: true, force: true })
    root = undefined
})

describe('resolveLegacyClaudeMessageUuid', () => {
    it('maps a stable assistant API message id to the Claude JSONL message UUID', async () => {
        root = await mkdtemp(join(tmpdir(), 'hapi-legacy-anchor-'))
        process.env.CLAUDE_CONFIG_DIR = root
        const cwd = '/workspace/project'
        const project = getProjectPath(cwd)
        await mkdir(project, { recursive: true })
        await writeFile(join(project, 'source.jsonl'), [
            JSON.stringify({ type: 'assistant', uuid: 'uuid-a', message: { id: 'msg_a' } }),
            JSON.stringify({ type: 'assistant', uuid: 'uuid-b-thinking', message: { id: 'msg_b' } }),
            JSON.stringify({ type: 'assistant', uuid: 'uuid-b', message: { id: 'msg_b' } })
        ].join('\n'))

        await expect(resolveLegacyClaudeMessageUuid({
            sourceSessionId: 'source',
            sourceCwd: cwd,
            assistantMessageId: 'msg_b'
        })).resolves.toBe('uuid-b')
    })
})
