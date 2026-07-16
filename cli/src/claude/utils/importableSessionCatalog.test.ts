import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { listImportableClaudeSessions } from './importableSessionCatalog'

describe('listImportableClaudeSessions', () => {
    const root = join(tmpdir(), `claude-import-catalog-${process.pid}`)
    const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

    afterEach(async () => {
        if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
        else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
        await rm(root, { recursive: true, force: true })
    })

    it('uses a stable path-free keyset cursor without page overlap', async () => {
        process.env.CLAUDE_CONFIG_DIR = root
        const project = join(root, 'projects', 'project-secret')
        await mkdir(project, { recursive: true })
        const timestamp = new Date('2026-01-01T00:00:00.000Z')
        for (let index = 0; index < 51; index += 1) {
            const id = `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
            const path = join(project, `${id}.jsonl`)
            await writeFile(path, `${JSON.stringify({ type: 'user', cwd: '/workspace', message: { role: 'user', content: `prompt ${index}` } })}\n`)
            await utimes(path, timestamp, timestamp)
        }

        const first = await listImportableClaudeSessions({ provider: 'claude' })
        expect(first.sessions).toHaveLength(50)
        expect(first.nextCursor).not.toBeNull()
        const decodedCursor = Buffer.from(first.nextCursor!, 'base64url').toString('utf8')
        expect(decodedCursor).not.toContain('project-secret')
        expect(decodedCursor).not.toContain('.jsonl')

        const second = await listImportableClaudeSessions({ provider: 'claude', cursor: first.nextCursor! })
        expect(second.sessions).toHaveLength(1)
        expect(second.nextCursor).toBeNull()
        expect(first.sessions.map((session) => session.externalSessionId)).not.toContain(second.sessions[0]?.externalSessionId)

        const filtered = await listImportableClaudeSessions({ provider: 'claude', cwd: '/workspace', query: 'prompt 50' })
        expect(filtered.sessions.map((session) => session.preview)).toEqual(['prompt 50'])
    })
})
