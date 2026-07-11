import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { registerFileHandlers } from './files'

type FileResponse = {
    success: boolean
    content?: string
    hash?: string
    error?: string
}

describe('file RPC handlers', () => {
    let rootDir: string
    let extraTempDir: string
    let rpc: RpcHandlerManager

    beforeEach(async () => {
        rootDir = await mkdtemp(join(tmpdir(), 'hapi-file-handler-'))
        extraTempDir = await mkdtemp(join(tmpdir(), 'hapi-file-handler-output-'))
        await writeFile(join(rootDir, 'note.txt'), 'original')
        await writeFile(join(rootDir, 'inside.txt'), 'inside workspace')
        await writeFile(join(extraTempDir, 'output.txt'), 'temporary output')
        rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerFileHandlers(rpc, rootDir)
    })

    afterEach(async () => {
        await rm(rootDir, { recursive: true, force: true })
        await rm(extraTempDir, { recursive: true, force: true })
    })

    async function request(method: 'readFile' | 'writeFile', params: object): Promise<FileResponse> {
        const response = await rpc.handleRequest({
            method: `session-test:${method}`,
            params: JSON.stringify(params)
        })
        return JSON.parse(response) as FileResponse
    }

    it('reads files inside the session workspace', async () => {
        const parsed = await request('readFile', { path: 'inside.txt' })

        expect(parsed.success).toBe(true)
        expect(Buffer.from(parsed.content ?? '', 'base64').toString('utf8')).toBe('inside workspace')
    })

    it('reads files from the system temporary directory', async () => {
        const parsed = await request('readFile', { path: join(extraTempDir, 'output.txt') })

        expect(parsed.success).toBe(true)
        expect(Buffer.from(parsed.content ?? '', 'base64').toString('utf8')).toBe('temporary output')
    })

    it('rejects absolute paths outside workspace and temp directory', async () => {
        const parsed = await request('readFile', { path: '/etc/passwd' })

        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('outside the working directory')
    })

    it('returns the content hash and writes relative to the session directory', async () => {
        const originalHash = createHash('sha256').update('original').digest('hex')
        const read = await request('readFile', { path: 'note.txt' })
        expect(read).toEqual({
            success: true,
            content: Buffer.from('original').toString('base64'),
            hash: originalHash
        })

        const write = await request('writeFile', {
            path: 'note.txt',
            content: Buffer.from('updated').toString('base64'),
            expectedHash: originalHash
        })

        expect(write.success).toBe(true)
        expect(await readFile(join(rootDir, 'note.txt'), 'utf8')).toBe('updated')
    })

    it('rejects a stale write without changing the file', async () => {
        const result = await request('writeFile', {
            path: 'note.txt',
            content: Buffer.from('updated').toString('base64'),
            expectedHash: '0'.repeat(64)
        })

        expect(result.success).toBe(false)
        expect(result.error).toContain('File hash mismatch')
        expect(await readFile(join(rootDir, 'note.txt'), 'utf8')).toBe('original')
    })
})
