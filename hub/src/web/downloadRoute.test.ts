/**
 * Download route tests: token gating + path-traversal / filename safety.
 * The route is only wired when HAPI_DOWNLOAD_TOKEN is set; we exercise the
 * same handler contract via a fresh app built with the env var present.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono, type Context } from 'hono'
import { constantTimeEquals } from '../utils/crypto'
import { existsSync } from 'node:fs'

// Rebuild the same handler logic in isolation (mirrors server.ts) so we can
// unit-test it without standing up the full hub. Kept in sync intentionally.
function makeDownloadApp(downloadToken: string, downloadDir: string): Hono {
    const app = new Hono()
    const safeFile = /^[A-Za-z0-9._-]+$/
    const serveDownload = (c: Context, headOnly: boolean): Response => {
        if (!constantTimeEquals(c.req.param('token'), downloadToken)) {
            return c.text('Not found', 404)
        }
        const file = c.req.param('file')
        if (!file || !safeFile.test(file)) {
            return c.text('Invalid file name', 400)
        }
        const path = join(downloadDir, file)
        if (!existsSync(path)) {
            return c.text('Not found', 404)
        }
        const bunFile = Bun.file(path)
        const headers: Record<string, string> = {
            'content-type': 'application/octet-stream',
            'content-disposition': `attachment; filename="${file}"`,
            'content-length': String(bunFile.size),
            'cache-control': 'no-cache'
        }
        return new Response(headOnly ? null : bunFile, { headers })
    }
    app.get('/download/:token/:file', (c) => serveDownload(c, false))
    app.on('HEAD', '/download/:token/:file', (c) => serveDownload(c, true))
    return app
}

let dir: string
const TOKEN = 'secret-token-abc123'

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hapi-dl-'))
    writeFileSync(join(dir, 'hapi-macos-arm64'), 'BINARY-CONTENT')
})

afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
})

describe('download route', () => {
    it('serves an existing file with the correct token', async () => {
        const app = makeDownloadApp(TOKEN, dir)
        const res = await app.request(`/download/${TOKEN}/hapi-macos-arm64`)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-disposition')).toContain('hapi-macos-arm64')
        expect(await res.text()).toBe('BINARY-CONTENT')
    })

    it('rejects a wrong token with 404 (no existence oracle)', async () => {
        const app = makeDownloadApp(TOKEN, dir)
        const res = await app.request('/download/wrong-token/hapi-macos-arm64')
        expect(res.status).toBe(404)
    })

    it('rejects path traversal in the file segment', async () => {
        const app = makeDownloadApp(TOKEN, dir)
        // Hono decodes %2F to a path separator, which won't match the single
        // :file segment; a literal ../ is rejected by the safeFile pattern.
        const res = await app.request(`/download/${TOKEN}/..%2F..%2Fetc%2Fpasswd`)
        expect(res.status).toBeGreaterThanOrEqual(400)
    })

    it('rejects filenames with disallowed characters', async () => {
        const app = makeDownloadApp(TOKEN, dir)
        const res = await app.request(`/download/${TOKEN}/foo$bar`)
        expect(res.status).toBe(400)
    })

    it('404s a nonexistent but well-named file', async () => {
        const app = makeDownloadApp(TOKEN, dir)
        const res = await app.request(`/download/${TOKEN}/not-here`)
        expect(res.status).toBe(404)
    })

    it('HEAD returns headers without a body', async () => {
        const app = makeDownloadApp(TOKEN, dir)
        const res = await app.request(`/download/${TOKEN}/hapi-macos-arm64`, { method: 'HEAD' })
        expect(res.status).toBe(200)
        expect(res.headers.get('content-length')).toBe(String('BINARY-CONTENT'.length))
        expect(await res.text()).toBe('')
    })
})
