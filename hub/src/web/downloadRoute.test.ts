import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { mountDownloadRoute } from '../../../fork-features/download-route/hubMount'

let directory: string
const token = 'secret-token-abc123'

beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'hapi-download-route-'))
    writeFileSync(join(directory, 'hapi-macos-arm64'), 'BINARY-CONTENT')
})

afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
})

function createApp(input: { token?: string; directory?: string } = { token, directory }): Hono {
    const app = new Hono()
    mountDownloadRoute(app, input)
    return app
}

describe('download route', () => {
    it('serves a whitelisted file with the configured token', async () => {
        const response = await createApp().request(`/download/${token}/hapi-macos-arm64`)

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('application/octet-stream')
        expect(response.headers.get('content-disposition')).toBe('attachment; filename="hapi-macos-arm64"')
        expect(response.headers.get('cache-control')).toBe('no-cache')
        expect(await response.text()).toBe('BINARY-CONTENT')
    })

    it('returns headers without a body for HEAD', async () => {
        const response = await createApp().request(`/download/${token}/hapi-macos-arm64`, { method: 'HEAD' })

        expect(response.status).toBe(200)
        expect(response.headers.get('content-length')).toBe(String('BINARY-CONTENT'.length))
        expect(await response.text()).toBe('')
    })

    it('does not mount without both token and directory', async () => {
        for (const input of [
            { directory },
            { token },
            { token: '   ', directory },
            { token, directory: '   ' }
        ]) {
            expect((await createApp(input).request(`/download/${token}/hapi-macos-arm64`)).status).toBe(404)
        }
    })

    it('hides files from a wrong token', async () => {
        expect((await createApp().request('/download/wrong-token/hapi-macos-arm64')).status).toBe(404)
    })

    it('rejects traversal and disallowed file names', async () => {
        expect((await createApp().request(`/download/${token}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(400)
        expect((await createApp().request(`/download/${token}/foo$bar`)).status).toBe(400)
    })

    it('hides a missing whitelisted file', async () => {
        expect((await createApp().request(`/download/${token}/not-here`)).status).toBe(404)
    })
})
