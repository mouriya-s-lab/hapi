import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { registerImportableSessionHandlers } from './importableSessions'

const originalClaude = process.env.CLAUDE_CONFIG_DIR
const roots: string[] = []

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
    if (originalClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaude
})

function transcript(path: string, cwd: string): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify({ type: 'user', uuid: path, cwd, message: { content: 'private prompt' } })}\n`)
}

describe('importable session RPC workspace boundary', () => {
    it('filters listing and resolve through the machine canonical-path predicate', async () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-import-handler-'))
        roots.push(root)
        process.env.CLAUDE_CONFIG_DIR = join(root, 'claude')
        transcript(join(root, 'claude/projects/p/allowed.jsonl'), '/workspace/allowed')
        transcript(join(root, 'claude/projects/p/private.jsonl'), '/workspace/link-to-private')

        const rpc = new RpcHandlerManager({ scopePrefix: 'machine' })
        registerImportableSessionHandlers(rpc, async (cwd) => cwd === '/workspace/allowed')
        const listed = JSON.parse(await rpc.handleRequest({
            method: `machine:${RPC_METHODS.ListImportableSessions}`,
            params: JSON.stringify({ agent: 'claude' })
        })) as { sessions: Array<{ externalSessionId: string }> }
        expect(listed.sessions.map((session) => session.externalSessionId)).toEqual(['allowed'])

        const resolved = JSON.parse(await rpc.handleRequest({
            method: `machine:${RPC_METHODS.ResolveImportableSession}`,
            params: JSON.stringify({ agent: 'claude', externalSessionId: 'private' })
        })) as { type: string; error?: string }
        expect(resolved).toEqual({ type: 'error', error: "Session is outside this machine's workspace roots" })
    })
})
