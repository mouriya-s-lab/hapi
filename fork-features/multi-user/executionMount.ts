import type { Hono, MiddlewareHandler } from 'hono'
import { jwtVerify } from 'jose'
import { toSessionSummary } from '../../shared/src/sessionSummary'
import type { SyncEngine } from '../../hub/src/sync/syncEngine'
import type { SSEManager } from '../../hub/src/sse/sseManager'
import type { WebAppEnv } from '../../hub/src/web/middleware/auth'
import type { MultiUserGatewayStore } from './gatewayStore'
import { ExecutionDispatcher } from './executionDispatcher'
import type { Capability, ResourceType } from './domain'
import { streamSSE } from 'hono/streaming'
import { randomUUID } from 'node:crypto'

async function gatewayAccountId(request: Request, secret: Uint8Array): Promise<number | null> {
    const authorization = request.headers.get('authorization')
    const queryToken = new URL(request.url).searchParams.get('token')
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : queryToken
    if (!token) return null
    try {
        const verified = await jwtVerify(token, secret, { algorithms: ['HS256'] })
        return typeof verified.payload.gaid === 'number' ? verified.payload.gaid : null
    } catch {
        return null
    }
}

const resourceFromPath = (path: string): { type: ResourceType; id: string } | null => {
    const match = path.match(/^\/api\/(sessions|machines)\/([^/]+)/)
    if (!match?.[1] || !match[2]) return null
    return { type: match[1] === 'machines' ? 'machine' : 'session', id: decodeURIComponent(match[2]) }
}

const capabilityFor = (method: string): Capability => method === 'GET' ? 'read' : 'operate'

export function createExecutionMiddleware(deps: {
    store: MultiUserGatewayStore
    jwtSecret: Uint8Array
}): MiddlewareHandler<WebAppEnv> {
    const dispatcher = new ExecutionDispatcher(deps.store)
    return async (c, next) => {
        const resource = resourceFromPath(c.req.path)
        if (!resource) { await next(); return }
        const accountId = await gatewayAccountId(c.req.raw, deps.jwtSecret)
        if (accountId === null) return c.json({ error: 'Invalid gateway identity' }, 401)
        const decision = dispatcher.authorize({ accountId, capability: capabilityFor(c.req.method), resource })
        if (decision.kind === 'deny') return c.json({ error: 'Insufficient permissions' }, 403)
        c.set('namespace', decision.context.namespace)
        c.set('registerCreatedSession' as never, ((sessionId: string) => deps.store.bindResource({
            resourceType: 'session',
            resourceId: sessionId,
            ownerAccountId: accountId,
            coreNamespace: decision.context.namespace
        })) as never)
        await next()
        const isMachineSpawn = resource.type === 'machine' && c.req.method === 'POST' && c.req.path.endsWith('/spawn')
        const isSessionFork = resource.type === 'session' && c.req.method === 'POST' && c.req.path.endsWith('/fork')
        if ((isMachineSpawn || isSessionFork) && c.res.ok) {
            const body = await c.res.clone().json().catch(() => null) as { sessionId?: unknown } | null
            const createdSessionId = isSessionFork
                ? (body as { newSessionId?: unknown } | null)?.newSessionId
                : body?.sessionId
            if (typeof createdSessionId === 'string') {
                deps.store.bindResource({
                    resourceType: 'session', resourceId: createdSessionId,
                    ownerAccountId: accountId, coreNamespace: decision.context.namespace
                })
            }
        }
        return
    }
}

export function mountExecutionRoutes(app: Hono<WebAppEnv>, deps: {
    store: MultiUserGatewayStore
    jwtSecret: Uint8Array
    getSyncEngine: () => SyncEngine | null
    getSseManager: () => SSEManager | null
}): void {
    app.get('/api/events', async (c) => {
        const accountId = await gatewayAccountId(c.req.raw, deps.jwtSecret)
        const account = accountId === null ? null : deps.store.getAccount(accountId)
        const manager = deps.getSseManager()
        if (!account || !manager) return c.json({ error: 'Not connected' }, account ? 503 : 401)
        const groupId = randomUUID()
        const bindings = [
            ...deps.store.listAccessibleResources('session', account.id),
            ...deps.store.listAccessibleResources('machine', account.id)
        ].filter(binding => binding.ownerAccountId !== account.id)
        return streamSSE(c, async stream => {
            const ids: string[] = []
            const subscribe = (input: { namespace: string; all?: boolean; sessionId?: string; machineId?: string }) => {
                const id = `${groupId}:${ids.length}`
                ids.push(id)
                manager.subscribe({
                    id,
                    namespace: input.namespace,
                    all: input.all,
                    sessionId: input.sessionId,
                    machineId: input.machineId,
                    visibility: ids.length === 1 ? 'visible' : 'hidden',
                    send: event => stream.writeSSE({ data: JSON.stringify(event) }),
                    sendHeartbeat: () => ids.length === 1
                        ? stream.writeSSE({ data: JSON.stringify({ type: 'heartbeat', namespace: account.defaultNamespace, data: { timestamp: Date.now() } }) })
                        : Promise.resolve()
                })
            }
            subscribe({ namespace: account.defaultNamespace, all: true })
            for (const binding of bindings) {
                subscribe({
                    namespace: binding.coreNamespace,
                    sessionId: binding.resourceType === 'session' ? binding.resourceId : undefined,
                    machineId: binding.resourceType === 'machine' ? binding.resourceId : undefined
                })
            }
            await stream.writeSSE({ data: JSON.stringify({ type: 'connection-changed', data: { status: 'connected', subscriptionId: ids[0] } }) })
            await new Promise<void>(resolve => {
                const done = () => resolve()
                c.req.raw.signal.addEventListener('abort', done, { once: true })
                stream.onAbort(done)
            })
            for (const id of ids) manager.unsubscribe(id)
        })
    })

    app.get('/api/sessions', async (c) => {
        const accountId = await gatewayAccountId(c.req.raw, deps.jwtSecret)
        const account = accountId === null ? null : deps.store.getAccount(accountId)
        const engine = deps.getSyncEngine()
        if (!account || !engine) return c.json({ error: 'Not connected' }, account ? 503 : 401)
        for (const session of engine.getSessionsByNamespace(account.defaultNamespace)) {
            if (!deps.store.getResource('session', session.id)) deps.store.bindResource({ resourceType: 'session', resourceId: session.id, ownerAccountId: account.id, coreNamespace: account.defaultNamespace })
        }
        const sessions = deps.store.listAccessibleResources('session', account.id)
            .map(binding => engine.getSession(binding.resourceId))
            .filter(session => session !== null)
            .map(session => toSessionSummary(session!))
        return c.json({ sessions })
    })

    app.get('/api/machines', async (c) => {
        const accountId = await gatewayAccountId(c.req.raw, deps.jwtSecret)
        const account = accountId === null ? null : deps.store.getAccount(accountId)
        const engine = deps.getSyncEngine()
        if (!account || !engine) return c.json({ error: 'Not connected' }, account ? 503 : 401)
        for (const machine of engine.getOnlineMachinesByNamespace(account.defaultNamespace)) {
            if (!deps.store.getResource('machine', machine.id)) deps.store.bindResource({ resourceType: 'machine', resourceId: machine.id, ownerAccountId: account.id, coreNamespace: account.defaultNamespace })
        }
        const machines = deps.store.listAccessibleResources('machine', account.id)
            .map(binding => engine.getMachine(binding.resourceId))
            .filter(machine => machine !== null)
        return c.json({ machines })
    })
}
