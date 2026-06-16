import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { RpcHandlerManager } from '../../../api/rpc/RpcHandlerManager'
import { registerFileHandlers } from './files'

async function createTempDir(prefix: string): Promise<string> {
    const path = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(path, { recursive: true })
    return path
}

describe('file RPC handlers', () => {
    let rootDir: string
    let extraTempDir: string
    let rpc: RpcHandlerManager

    beforeEach(async () => {
        if (rootDir) await rm(rootDir, { recursive: true, force: true })
        if (extraTempDir) await rm(extraTempDir, { recursive: true, force: true })

        rootDir = await createTempDir('hapi-file-handler-root')
        extraTempDir = await createTempDir('hapi-file-handler-output')
        await writeFile(join(rootDir, 'inside.txt'), 'inside workspace')
        await writeFile(join(extraTempDir, 'output.txt'), 'temporary output')

        rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerFileHandlers(rpc, rootDir)
    })

    it('reads files inside the session workspace', async () => {
        const response = await rpc.handleRequest({
            method: 'session-test:readFile',
            params: JSON.stringify({ path: 'inside.txt' })
        })
        const parsed = JSON.parse(response) as { success: boolean; content?: string }

        expect(parsed.success).toBe(true)
        expect(Buffer.from(parsed.content ?? '', 'base64').toString('utf8')).toBe('inside workspace')
    })

    it('reads files from the system temporary directory', async () => {
        const response = await rpc.handleRequest({
            method: 'session-test:readFile',
            params: JSON.stringify({ path: join(extraTempDir, 'output.txt') })
        })
        const parsed = JSON.parse(response) as { success: boolean; content?: string }

        expect(parsed.success).toBe(true)
        expect(Buffer.from(parsed.content ?? '', 'base64').toString('utf8')).toBe('temporary output')
    })

    it('rejects absolute paths outside workspace and temp directory', async () => {
        const response = await rpc.handleRequest({
            method: 'session-test:readFile',
            params: JSON.stringify({ path: '/etc/passwd' })
        })
        const parsed = JSON.parse(response) as { success: boolean; error?: string }

        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('outside the working directory')
    })
})
