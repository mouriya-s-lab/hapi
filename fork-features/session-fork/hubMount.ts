import type { Hono } from 'hono'
import { forkSession, HttpError, type ForkDeps } from './hubForkController'
import { getAllForkCapabilities } from './forkCapabilities'

export type ForkSyncEngineLike = ForkDeps

type StatusCode = 200 | 400 | 404 | 409 | 500 | 502 | 503

/**
 * Mount fork-related HTTP routes onto an existing Hono app. `getDeps` receives
 * the per-request namespace (from Hono context) and builds a ForkDeps
 * instance backed by the live SyncEngine + Store; returning null when the
 * engine isn't ready makes the route 503 instead of 500-ing.
 */
export function mountForkRoutes(
    app: Hono<any>,
    getDeps: (namespace: string) => ForkSyncEngineLike | null
): void {
    app.get('/api/flavors/capabilities', (c) => {
        return c.json({ capabilities: getAllForkCapabilities() })
    })

    app.post('/api/sessions/:id/fork', async (c) => {
        const namespace = (c.get('namespace' as never) as string | undefined) ?? 'default'
        const deps = getDeps(namespace)
        if (!deps) {
            return c.json({ error: 'sync engine unavailable' }, 503 as StatusCode)
        }
        const srcSessionId = c.req.param('id')

        // Optional per-message forkPoint. Client sends only messageId; hub
        // controller computes tailOffset. Body may be absent (HEAD fork) or
        // shape-invalid — we treat unparseable/missing/empty body as HEAD.
        let forkPoint: { messageId: string } | undefined
        try {
            const body = (await c.req.json().catch(() => null)) as
                | { forkPoint?: unknown }
                | null
            const raw = body?.forkPoint
            if (raw && typeof raw === 'object') {
                const messageId = (raw as { messageId?: unknown }).messageId
                if (typeof messageId === 'string' && messageId.length > 0) {
                    forkPoint = { messageId }
                } else {
                    return c.json(
                        { error: 'forkPoint.messageId must be a non-empty string' },
                        400 as StatusCode
                    )
                }
            }
        } catch {
            // ignore body parse errors — treat as HEAD fork
        }

        try {
            const result = await forkSession({ srcSessionId, deps, forkPoint })
            return c.json(result)
        } catch (err) {
            if (err instanceof HttpError) {
                return c.json({ error: err.message }, err.status as StatusCode)
            }
            const message = err instanceof Error ? err.message : 'fork failed'
            return c.json({ error: message }, 500 as StatusCode)
        }
    })
}
