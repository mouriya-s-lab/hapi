import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import type { Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createAuthMiddleware } from '../middleware/auth'
import { createGitRoutes } from './git'

const JWT_SECRET = new TextEncoder().encode('generated-media-route-test')

async function authHeaders(namespace: string): Promise<{ authorization: string }> {
    const token = await new SignJWT({ uid: 1, ns: namespace })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(JWT_SECRET)
    return { authorization: `Bearer ${token}` }
}

function buildApp(engine: Partial<SyncEngine>): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createGitRoutes(() => engine as SyncEngine))
    return app
}

function buildAuthenticatedApp(engine: Partial<SyncEngine>): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.use('*', createAuthMiddleware(JWT_SECRET))
    app.route('/api', createGitRoutes(() => engine as SyncEngine))
    return app
}

describe('session file route', () => {
    it('forwards an optimistic file write to the session RPC', async () => {
        const session = { id: 'session-1', namespace: 'default', active: true } as unknown as Session
        const calls: unknown[][] = []
        const engine = {
            resolveSessionAccess: () => ({ ok: true as const, sessionId: 'session-1', session }),
            writeSessionFile: async (...args: unknown[]) => {
                calls.push(args)
                return { success: true, hash: 'b'.repeat(64) }
            }
        } as unknown as Partial<SyncEngine>

        const response = await buildApp(engine).request('/api/sessions/session-1/file', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                path: 'README.md',
                content: Buffer.from('# updated').toString('base64'),
                expectedHash: 'a'.repeat(64)
            })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ success: true, hash: 'b'.repeat(64) })
        expect(calls).toEqual([[
            'session-1',
            'README.md',
            Buffer.from('# updated').toString('base64'),
            'a'.repeat(64)
        ]])
    })

    it('rejects a write without a content hash', async () => {
        const session = { id: 'session-1', namespace: 'default', active: true } as unknown as Session
        const engine = {
            resolveSessionAccess: () => ({ ok: true as const, sessionId: 'session-1', session })
        } as unknown as Partial<SyncEngine>

        const response = await buildApp(engine).request('/api/sessions/session-1/file', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'README.md', content: 'dGVzdA==' })
        })

        expect(response.status).toBe(400)
    })
})

describe('generated images route', () => {
    it('serves generated images with an immutable cache header instead of no-store', async () => {
        const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        const session = { id: 'session-1', namespace: 'default', active: true } as unknown as Session
        const engine = {
            resolveSessionAccess: () => ({ ok: true as const, sessionId: 'session-1', session }),
            readGeneratedImage: async () => ({
                success: true,
                content: pngBytes.toString('base64'),
                mimeType: 'image/png',
                fileName: 'shot.png'
            })
        } as unknown as Partial<SyncEngine>

        const response = await buildApp(engine).request('/api/sessions/session-1/generated-images/img-1')

        expect(response.status).toBe(200)
        const cacheControl = response.headers.get('cache-control') ?? ''
        // Generated images are content-addressed by an immutable random id, so they must be
        // cacheable; `no-store` forces a full RPC round-trip on every remount (issue #927).
        expect(cacheControl).toContain('immutable')
        expect(cacheControl).not.toContain('no-store')
        expect(response.headers.get('etag')).toBe('"img-1"')
    })

    it('returns 304 without an RPC round-trip when If-None-Match matches', async () => {
        const session = { id: 'session-1', namespace: 'default', active: true } as unknown as Session
        let rpcCalls = 0
        const engine = {
            resolveSessionAccess: () => ({ ok: true as const, sessionId: 'session-1', session }),
            readGeneratedImage: async () => {
                rpcCalls += 1
                return { success: true, content: '', mimeType: 'image/png', fileName: 'shot.png' }
            }
        } as unknown as Partial<SyncEngine>

        const response = await buildApp(engine).request('/api/sessions/session-1/generated-images/img-1', {
            headers: { 'if-none-match': '"img-1"' }
        })

        expect(response.status).toBe(304)
        // The whole point: a cache hit must not touch the CLI over the socket.
        expect(rpcCalls).toBe(0)
    })

    it('serves registered MP4 bytes with their video MIME type', async () => {
        const mp4Bytes = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
        const session = { id: 'session-1', namespace: 'default', active: true } as unknown as Session
        const engine = {
            resolveSessionAccess: () => ({ ok: true as const, sessionId: 'session-1', session }),
            readGeneratedImage: async () => ({
                success: true,
                content: mp4Bytes.toString('base64'),
                mimeType: 'video/mp4',
                fileName: 'recording.mp4'
            })
        } as unknown as Partial<SyncEngine>

        const response = await buildApp(engine).request('/api/sessions/session-1/generated-images/video-1')

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('video/mp4')
        expect(Buffer.from(await response.arrayBuffer())).toEqual(mp4Bytes)
    })

    it('requires JWT auth and enforces namespace-scoped session access', async () => {
        const engine = {
            resolveSessionAccess: (_sessionId: string, namespace: string) => namespace === 'owner'
                ? {
                    ok: true as const,
                    sessionId: 'session-1',
                    session: { id: 'session-1', namespace: 'owner', active: true } as unknown as Session
                }
                : { ok: false as const, reason: 'access-denied' as const }
        } as unknown as Partial<SyncEngine>
        const app = buildAuthenticatedApp(engine)

        const missingAuth = await app.request('/api/sessions/session-1/generated-images/img-1')
        const wrongNamespace = await app.request('/api/sessions/session-1/generated-images/img-1', {
            headers: await authHeaders('other')
        })

        expect(missingAuth.status).toBe(401)
        expect(wrongNamespace.status).toBe(403)
    })
})
describe('generated files route', () => {
    it('serves sent files as attachments with immutable caching', async () => {
        const fileBytes = Buffer.from('hello report')
        const session = { id: 'session-1', namespace: 'default', active: true } as unknown as Session
        const engine = {
            resolveSessionAccess: () => ({ ok: true as const, sessionId: 'session-1', session }),
            readGeneratedFile: async () => ({
                success: true,
                content: fileBytes.toString('base64'),
                mimeType: 'application/pdf',
                fileName: 'report.pdf',
                size: fileBytes.byteLength
            })
        } as unknown as Partial<SyncEngine>

        const response = await buildApp(engine).request('/api/sessions/session-1/generated-files/file-1')

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('application/pdf')
        expect(response.headers.get('content-disposition') ?? '').toContain('attachment')
        expect(response.headers.get('content-disposition') ?? '').toContain('report.pdf')
        const cacheControl = response.headers.get('cache-control') ?? ''
        expect(cacheControl).toContain('immutable')
        expect(response.headers.get('etag')).toBe('"file-1"')
        expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('hello report')
    })

    it('returns 304 without an RPC round-trip when If-None-Match matches', async () => {
        const session = { id: 'session-1', namespace: 'default', active: true } as unknown as Session
        let rpcCalls = 0
        const engine = {
            resolveSessionAccess: () => ({ ok: true as const, sessionId: 'session-1', session }),
            readGeneratedFile: async () => {
                rpcCalls += 1
                return { success: true, content: '', mimeType: 'application/pdf', fileName: 'report.pdf' }
            }
        } as unknown as Partial<SyncEngine>

        const response = await buildApp(engine).request('/api/sessions/session-1/generated-files/file-1', {
            headers: { 'if-none-match': '"file-1"' }
        })

        expect(response.status).toBe(304)
        expect(rpcCalls).toBe(0)
    })

    it('returns 404 when the sent file is gone from the CLI', async () => {
        const session = { id: 'session-1', namespace: 'default', active: true } as unknown as Session
        const engine = {
            resolveSessionAccess: () => ({ ok: true as const, sessionId: 'session-1', session }),
            readGeneratedFile: async () => ({ success: false, error: 'Sent file not found' })
        } as unknown as Partial<SyncEngine>

        const response = await buildApp(engine).request('/api/sessions/session-1/generated-files/file-1')

        expect(response.status).toBe(404)
    })
})
