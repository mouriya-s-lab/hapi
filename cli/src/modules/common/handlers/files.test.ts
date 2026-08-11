import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { registerFileHandlers } from './files'

type FileResponse = {
    success: boolean
    content?: string
    hash?: string
    size?: number
    modified?: number
    error?: string
}

describe('file RPC handlers', () => {
    let rootDir: string
    let rpc: RpcHandlerManager

    beforeEach(async () => {
        rootDir = await mkdtemp(join(tmpdir(), 'hapi-file-handler-'))
        await writeFile(join(rootDir, 'note.txt'), 'original')
        rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerFileHandlers(rpc, rootDir)
    })

    afterEach(async () => {
        await rm(rootDir, { recursive: true, force: true })
    })

    async function request(method: 'readFile' | 'writeFile', params: object): Promise<FileResponse> {
        const response = await rpc.handleRequest({
            method: `session-test:${method}`,
            params: JSON.stringify(params)
        })
        return JSON.parse(response) as FileResponse
    }

    it('returns file metadata alongside content', async () => {
        const filePath = join(rootDir, 'README.md')
        await writeFile(filePath, '# test')
        const expectedStats = await stat(filePath)
        const expectedHash = createHash('sha256').update('# test').digest('hex')

        const response = await request('readFile', { path: 'README.md' })

        expect(response.success).toBe(true)
        expect(response.content).toBe(Buffer.from('# test').toString('base64'))
        expect(response.hash).toBe(expectedHash)
        expect(response.size).toBe(expectedStats.size)
        expect(response.modified).toBe(expectedStats.mtime.getTime())
    })

    it('returns the content hash and writes relative to the session directory', async () => {
        const originalHash = createHash('sha256').update('original').digest('hex')
        const read = await request('readFile', { path: 'note.txt' })
        expect(read.success).toBe(true)
        expect(read.content).toBe(Buffer.from('original').toString('base64'))
        expect(read.hash).toBe(originalHash)

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
