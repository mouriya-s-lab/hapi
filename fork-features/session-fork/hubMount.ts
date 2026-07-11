import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { forkSession, HttpError, type ForkDeps } from './hubForkController'
import { getAllForkCapabilities } from './forkCapabilities'

export type ForkSyncEngineLike = ForkDeps

type StatusCode = 200 | 400 | 404 | 409 | 500 | 502 | 503

export type ForkRouteHooks = {
    /** 多用户归属/授权守卫：返回 Response 即拒绝（403/404），null 放行。 */
    authorize?: (c: Context<any>) => Response | null
    /** fork 成功后回调（如把新会话 owner 记到发起人账号）。 */
    onForked?: (c: Context<any>, newSessionId: string) => void
}

const ForkRequestBodySchema = z.object({
    forkPoint: z.object({
        messageId: z.string().min(1)
    }).optional()
})

/**
 * Mount fork-related HTTP routes onto an existing Hono app. `getDeps` receives
 * the per-request namespace (from Hono context) and builds a ForkDeps
 * instance backed by the live SyncEngine + Store; returning null when the
 * engine isn't ready makes the route 503 instead of 500-ing.
 */
export function mountForkRoutes(
    app: Hono<any>,
    getDeps: (namespace: string) => ForkSyncEngineLike | null,
    hooks?: ForkRouteHooks
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
        const denied = hooks?.authorize?.(c)
        if (denied) {
            return denied
        }
        const srcSessionId = c.req.param('id')

        // Empty body means the existing HEAD-fork operation. Any non-empty
        // body is an explicit contract boundary: malformed JSON or an invalid
        // forkPoint must fail instead of silently changing the requested
        // operation into a HEAD fork.
        const rawBody = await c.req.text()
        let forkPoint: { messageId: string } | undefined
        if (rawBody.trim().length > 0) {
            let json: unknown
            try {
                json = JSON.parse(rawBody) as unknown
            } catch {
                return c.json({ error: 'request body must be valid JSON' }, 400 as StatusCode)
            }
            const parsed = ForkRequestBodySchema.safeParse(json)
            if (!parsed.success) {
                return c.json({ error: 'invalid fork request body', issues: parsed.error.issues }, 400 as StatusCode)
            }
            forkPoint = parsed.data.forkPoint
        }

        try {
            const result = await forkSession({ srcSessionId, deps, forkPoint })
            hooks?.onForked?.(c, result.newSessionId)
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
