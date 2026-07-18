import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, truncate, writeFile } from 'fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { RpcHandlerManager } from '../../api/rpc/RpcHandlerManager'
import { registerFileHandlers } from './handlers/files'
import { clearGeneratedFiles, detectFileMimeType, getGeneratedFile, MAX_GENERATED_FILE_BYTES, registerGeneratedFile } from './generatedFiles'

async function createTempDir(prefix: string): Promise<string> {
    const path = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(path, { recursive: true })
    return path
}

describe('generated files registry', () => {
    let sourceDir: string

    beforeEach(async () => {
        sourceDir = await createTempDir('hapi-sent-files-src')
    })

    afterEach(async () => {
        clearGeneratedFiles()
        await rm(sourceDir, { recursive: true, force: true })
    })

    it('snapshots the file so later edits do not change what the user downloads', async () => {
        const sourcePath = join(sourceDir, 'report.txt')
        await writeFile(sourcePath, 'v1 content')

        const file = await registerGeneratedFile({ id: 'file-1', path: sourcePath })
        await writeFile(sourcePath, 'v2 content')

        expect(file.fileName).toBe('report.txt')
        expect(file.size).toBe(Buffer.byteLength('v1 content'))
        expect(existsSync(file.snapshotPath)).toBe(true)
        const snapshot = await import('fs/promises').then((fs) => fs.readFile(file.snapshotPath, 'utf8'))
        expect(snapshot).toBe('v1 content')
    })

    it('uses the provided title as display filename', async () => {
        const sourcePath = join(sourceDir, 'raw-output.bin')
        await writeFile(sourcePath, 'data')

        const file = await registerGeneratedFile({ id: 'file-2', path: sourcePath, fileName: 'final report.pdf' })

        expect(file.fileName).toBe('final_report.pdf')
        expect(file.mimeType).toBe('text/plain')
    })

    it('keeps the source extension when the title omits it', async () => {
        const sourcePath = join(sourceDir, 'report.md')
        await writeFile(sourcePath, '# report')

        const file = await registerGeneratedFile({ id: 'file-2b', path: sourcePath, fileName: 'E2E Report' })

        expect(file.fileName).toBe('E2E_Report.md')
        expect(file.mimeType).toBe('text/markdown')
    })

    it('detects common mime types by extension and falls back to octet-stream', () => {
        expect(detectFileMimeType('a.pdf')).toBe('application/pdf')
        expect(detectFileMimeType('a.zip')).toBe('application/zip')
        expect(detectFileMimeType('a.csv')).toBe('text/csv')
        expect(detectFileMimeType('a.unknownext')).toBe('application/octet-stream')
    })

    it('sniffs actual bytes instead of trusting a misleading extension', async () => {
        const textNamedPdf = join(sourceDir, 'notes.pdf')
        const pdfNamedBin = join(sourceDir, 'document.bin')
        await writeFile(textNamedPdf, 'plain text')
        await writeFile(pdfNamedBin, '%PDF-1.7\n')

        const textFile = await registerGeneratedFile({ id: 'sniff-text', path: textNamedPdf })
        const pdfFile = await registerGeneratedFile({ id: 'sniff-pdf', path: pdfNamedBin })

        expect(textFile.mimeType).toBe('text/plain')
        expect(pdfFile.mimeType).toBe('application/pdf')
    })

    it('does not infer an empty snapshot MIME from a misleading extension', async () => {
        const emptyPdf = join(sourceDir, 'empty.pdf')
        await writeFile(emptyPdf, '')

        const file = await registerGeneratedFile({ id: 'sniff-empty', path: emptyPdf })

        expect(file.mimeType).toBe('text/plain')
    })

    it('rejects symbolic links even when their target is a regular file', async () => {
        const sourcePath = join(sourceDir, 'target.txt')
        const linkPath = join(sourceDir, 'link.txt')
        await writeFile(sourcePath, 'target')
        await import('fs/promises').then((fs) => fs.symlink(sourcePath, linkPath))

        await expect(registerGeneratedFile({ id: 'file-link', path: linkPath })).rejects.toThrow('not a regular file')
    })

    it('rejects directories', async () => {
        await expect(registerGeneratedFile({ id: 'file-3', path: sourceDir })).rejects.toThrow('not a regular file')
    })

    it('rejects a file whose base64 RPC response would exceed the socket transport limit', async () => {
        const sourcePath = join(sourceDir, 'oversized.bin')
        await writeFile(sourcePath, '')
        await truncate(sourcePath, MAX_GENERATED_FILE_BYTES + 1)

        await expect(registerGeneratedFile({ id: 'file-too-large', path: sourcePath })).rejects.toThrow(`max ${MAX_GENERATED_FILE_BYTES} bytes`)
    })

    it('serves registered files over the readGeneratedFile RPC', async () => {
        const sourcePath = join(sourceDir, 'result.json')
        await writeFile(sourcePath, '{"ok":true}')
        await registerGeneratedFile({ id: 'file-4', path: sourcePath })

        const rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerFileHandlers(rpc, sourceDir)

        const response = await rpc.handleRequest({
            method: 'session-test:readGeneratedFile',
            params: JSON.stringify({ id: 'file-4' })
        })
        const parsed = JSON.parse(response) as { success: boolean; content?: string; mimeType?: string; fileName?: string; size?: number }

        expect(parsed.success).toBe(true)
        expect(Buffer.from(parsed.content ?? '', 'base64').toString('utf8')).toBe('{"ok":true}')
        expect(parsed.mimeType).toBe('application/json')
        expect(parsed.fileName).toBe('result.json')
        expect(parsed.size).toBe(Buffer.byteLength('{"ok":true}'))
    })

    it('returns an error for unknown file ids over RPC', async () => {
        const rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerFileHandlers(rpc, sourceDir)

        const response = await rpc.handleRequest({
            method: 'session-test:readGeneratedFile',
            params: JSON.stringify({ id: 'missing' })
        })
        const parsed = JSON.parse(response) as { success: boolean; error?: string }

        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('not found')
    })

    it('clears the registry and snapshots on cleanup', async () => {
        const sourcePath = join(sourceDir, 'temp.txt')
        await writeFile(sourcePath, 'x')
        const file = await registerGeneratedFile({ id: 'file-5', path: sourcePath })

        clearGeneratedFiles()

        expect(getGeneratedFile('file-5')).toBeNull()
        expect(existsSync(file.snapshotPath)).toBe(false)
    })
})
