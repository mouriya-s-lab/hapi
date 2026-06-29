import type { Hono } from 'hono'
import { forkSession, HttpError, type ForkDeps } from './hubForkController'
import { listForkCapableFlavors } from './providerRegistry'

export type ForkSyncEngineLike = ForkDeps

type StatusCode = 200 | 400 | 404 | 409 | 500 | 502 | 503

/**
 * Mount fork-related HTTP routes onto an existing Hono app. The caller
 * passes a getDeps() function (in hub/src/web/server.ts) that translates
 * the live SyncEngine into the ForkDeps contract via hubSyncEngineAdapter.
 * Returns null when the engine isn't ready yet so we can 503.
 */
export function mountForkRoutes(
    app: Hono,
    getDeps: () => ForkSyncEngineLike | null
): void {
    app.get('/api/flavors/capabilities', (c) => {
        return c.json({ fork: listForkCapableFlavors() })
    })

    app.post('/api/sessions/:id/fork', async (c) => {
        const deps = getDeps()
        if (!deps) {
            return c.json({ error: 'sync engine unavailable' }, 503 as StatusCode)
        }
        const srcSessionId = c.req.param('id')
        try {
            const result = await forkSession({ srcSessionId, deps })
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
