import { randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { MessagesQuerySchema, type Session, type SyncEvent } from '@hapi/protocol'
import type { SyncEngine } from '../../hub/src/sync/syncEngine'
import type { WebAppEnv } from '../../hub/src/web/middleware/auth'
import {
    AgentCallerRequestSchema,
    AgentMessageQuerySchema,
    AgentPromptRequestSchema,
    AgentSpawnRequestSchema,
    AgentWaitRequestSchema,
    type AgentErrorCode,
    type AgentStatus
} from './protocol'
import {
    deriveAgentStatus,
    isDirectoryInAgentScope,
    isSessionInAgentScope,
    projectAgentMessages,
    toAgentSessionDetails,
    toAgentSessionSummary
} from './domain'

const DEFAULT_START_TIMEOUT_MS = 30_000
const DEFAULT_WAIT_TIMEOUT_MS = 180_000
const PROMPT_STALLED_MS = 5_000

type AgentRouteContext = Context<WebAppEnv>

class AgentRouteError extends Error {
    constructor(
        readonly code: AgentErrorCode,
        message: string
    ) {
        super(message)
        this.name = 'AgentRouteError'
    }
}

function agentErrorResponse(c: AgentRouteContext, error: AgentRouteError): Response {
    const body = { error: { code: error.code, message: error.message } }
    switch (error.code) {
        case 'bad_args': return c.json(body, 400)
        // CLI-side boundary code (#261); a hub route never produces it, but
        // the exhaustive switch must still map it.
        case 'not_hapi_session': return c.json(body, 400)
        case 'auth_failed': return c.json(body, 401)
        case 'scope_denied': return c.json(body, 403)
        case 'not_found': return c.json(body, 404)
        case 'dead_target':
        case 'agent_prompt_stalled': return c.json(body, 409)
        case 'timeout': return c.json(body, 408)
        case 'spawn_failed':
        case 'stop_failed': return c.json(body, 502)
        case 'internal_error': return c.json(body, 500)
    }
}

function routeFailure(c: AgentRouteContext, error: unknown): Response {
    if (error instanceof AgentRouteError) return agentErrorResponse(c, error)
    return agentErrorResponse(c, new AgentRouteError(
        'internal_error',
        error instanceof Error ? error.message : 'Unknown orchestration error'
    ))
}

function requireEngine(getSyncEngine: () => SyncEngine | null): SyncEngine {
    const engine = getSyncEngine()
    if (!engine) throw new AgentRouteError('internal_error', 'Hub sync engine is unavailable')
    return engine
}

function requireCaller(engine: SyncEngine, namespace: string, callerId: string): Session {
    const caller = engine.getSessionByNamespace(callerId, namespace)
    if (!caller) throw new AgentRouteError('not_found', `Caller session ${callerId} was not found`)
    if (!caller.active) throw new AgentRouteError('dead_target', `Caller session ${callerId} is inactive`)
    return caller
}

function requireScopedTarget(
    engine: SyncEngine,
    namespace: string,
    caller: Session,
    targetId: string
): Session {
    const target = engine.getSessionByNamespace(targetId, namespace)
    if (!target) throw new AgentRouteError('not_found', `Target session ${targetId} was not found`)
    if (!isSessionInAgentScope(caller, target)) {
        throw new AgentRouteError('scope_denied', `Target session ${targetId} is outside the caller communication scope`)
    }
    return target
}

function isTargetSessionEvent(event: SyncEvent, targetId: string): boolean {
    return 'sessionId' in event && event.sessionId === targetId
}

async function waitForStatuses(
    engine: SyncEngine,
    targetId: string,
    until: ReadonlySet<AgentStatus>,
    timeoutMs: number
): Promise<AgentStatus> {
    const current = engine.getSession(targetId)
    if (!current) throw new AgentRouteError('not_found', `Target session ${targetId} was not found`)

    const currentStatus = deriveAgentStatus(current)
    if (until.has(currentStatus)) return currentStatus
    if (currentStatus === 'dead') {
        throw new AgentRouteError('dead_target', `Target session ${targetId} became inactive`)
    }

    return await new Promise<AgentStatus>((resolve, reject) => {
        let settled = false
        const finish = (outcome: { status: AgentStatus } | { error: AgentRouteError }) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            unsubscribe()
            if ('status' in outcome) resolve(outcome.status)
            else reject(outcome.error)
        }
        const unsubscribe = engine.subscribe((event) => {
            if (!isTargetSessionEvent(event, targetId)) return
            const session = engine.getSession(targetId)
            if (!session) {
                finish({ error: new AgentRouteError('not_found', `Target session ${targetId} was not found`) })
                return
            }
            const status = deriveAgentStatus(session)
            if (until.has(status)) {
                finish({ status })
            } else if (status === 'dead') {
                finish({ error: new AgentRouteError('dead_target', `Target session ${targetId} became inactive`) })
            }
        })
        const timer = setTimeout(() => {
            finish({ error: new AgentRouteError('timeout', `Timed out waiting for session ${targetId}`) })
        }, timeoutMs)
    })
}

type MessageConsumptionWatcher = {
    promise: Promise<void>
    cancel: () => void
}

export function watchMessageConsumption(
    engine: Pick<SyncEngine, 'subscribe'>,
    targetId: string,
    localId: string
): MessageConsumptionWatcher {
    let settled = false
    let resolvePromise: () => void = () => {}
    const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve
    })
    const unsubscribe = engine.subscribe((event) => {
        if (event.type !== 'messages-consumed' || event.sessionId !== targetId) return
        if (!event.localIds.includes(localId) || settled) return
        settled = true
        unsubscribe()
        resolvePromise()
    })
    return {
        promise,
        cancel: () => {
            if (settled) return
            settled = true
            unsubscribe()
        }
    }
}

export async function requirePromptConsumption(
    watcher: MessageConsumptionWatcher,
    targetId: string,
    stalledMs = PROMPT_STALLED_MS
): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    try {
        await Promise.race([
            watcher.promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new AgentRouteError(
                    'agent_prompt_stalled',
                    `Target session ${targetId} did not consume the prompt within ${stalledMs}ms`
                )), stalledMs)
            })
        ])
    } finally {
        clearTimeout(timer)
        watcher.cancel()
    }
}

async function waitForSpawnedSession(
    engine: SyncEngine,
    sessionId: string,
    namespace: string,
    timeoutMs: number
): Promise<Session> {
    const current = engine.getSessionByNamespace(sessionId, namespace)
    if (current?.active) return current

    return await new Promise<Session>((resolve, reject) => {
        let settled = false
        const finish = (session?: Session, error?: AgentRouteError) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            unsubscribe()
            if (session) resolve(session)
            else reject(error ?? new AgentRouteError('spawn_failed', `Session ${sessionId} did not start`))
        }
        const unsubscribe = engine.subscribe((event) => {
            if (!isTargetSessionEvent(event, sessionId)) return
            const session = engine.getSessionByNamespace(sessionId, namespace)
            if (session?.active) finish(session)
        })
        const timer = setTimeout(() => finish(
            undefined,
            new AgentRouteError('timeout', `Timed out waiting for spawned session ${sessionId}`)
        ), timeoutMs)
    })
}

export function mountAgentOrchestrationRoutes(
    app: Hono<WebAppEnv>,
    getSyncEngine: () => SyncEngine | null
): void {
    app.get('/api/agent/sessions', (c) => {
        try {
            const query = AgentCallerRequestSchema.safeParse(c.req.query())
            if (!query.success) throw new AgentRouteError('bad_args', 'caller is required')
            const engine = requireEngine(getSyncEngine)
            const namespace = c.get('namespace')
            const caller = requireCaller(engine, namespace, query.data.caller)
            const sessions = engine.getSessionsByNamespace(namespace)
                .filter((session) => session.active && isSessionInAgentScope(caller, session))
                .flatMap((session) => {
                    const summary = toAgentSessionSummary(session)
                    return summary ? [summary] : []
                })
                .sort((a, b) => b.updatedAt - a.updatedAt)
            return c.json({ sessions })
        } catch (error) {
            return routeFailure(c, error)
        }
    })

    app.get('/api/agent/sessions/:id', (c) => {
        try {
            const query = AgentCallerRequestSchema.safeParse(c.req.query())
            if (!query.success) throw new AgentRouteError('bad_args', 'caller is required')
            const engine = requireEngine(getSyncEngine)
            const namespace = c.get('namespace')
            const caller = requireCaller(engine, namespace, query.data.caller)
            const target = requireScopedTarget(engine, namespace, caller, c.req.param('id'))
            const session = toAgentSessionDetails(target)
            if (!session) throw new AgentRouteError('not_found', 'Target session has incomplete orchestration metadata')
            return c.json({ session })
        } catch (error) {
            return routeFailure(c, error)
        }
    })

    app.get('/api/agent/sessions/:id/messages', (c) => {
        try {
            const orchestrationQuery = AgentMessageQuerySchema.safeParse(c.req.query())
            const messagesQuery = MessagesQuerySchema.safeParse(c.req.query())
            if (!orchestrationQuery.success || !messagesQuery.success) {
                throw new AgentRouteError('bad_args', 'Invalid message pagination query')
            }
            const engine = requireEngine(getSyncEngine)
            const namespace = c.get('namespace')
            const caller = requireCaller(engine, namespace, orchestrationQuery.data.caller)
            const target = requireScopedTarget(engine, namespace, caller, c.req.param('id'))
            const query = messagesQuery.data
            const response = engine.getMessagesPage(target.id, {
                limit: query.limit ?? 50,
                before: query.beforeAt === undefined ? null : { at: query.beforeAt, seq: query.beforeSeq! },
                after: query.afterAt === undefined ? null : { at: query.afterAt, seq: query.afterSeq! },
                until: query.untilAt === undefined ? null : { at: query.untilAt, seq: query.untilSeq! },
                epoch: query.epoch ?? null
            })
            if (orchestrationQuery.data.raw) {
                return c.json({ raw: true as const, messages: response.messages, page: response.page })
            }
            return c.json(projectAgentMessages(response))
        } catch (error) {
            return routeFailure(c, error)
        }
    })

    app.post('/api/agent/spawn', async (c) => {
        try {
            const parsed = AgentSpawnRequestSchema.safeParse(await c.req.json().catch(() => null))
            if (!parsed.success) throw new AgentRouteError('bad_args', 'Invalid agent start request')
            const engine = requireEngine(getSyncEngine)
            const namespace = c.get('namespace')
            const caller = requireCaller(engine, namespace, parsed.data.caller)
            if (!isDirectoryInAgentScope(caller, parsed.data.directory)) {
                throw new AgentRouteError('scope_denied', 'Spawn directory is outside the caller communication scope')
            }
            const machineId = caller.metadata?.machineId
            if (!machineId) throw new AgentRouteError('spawn_failed', 'Caller session has no machine id')

            const result = await engine.spawnSession(
                machineId,
                parsed.data.directory,
                parsed.data.agent,
                parsed.data.model
            )
            if (result.type === 'error') throw new AgentRouteError('spawn_failed', result.message)
            const session = await waitForSpawnedSession(
                engine,
                result.sessionId,
                namespace,
                parsed.data.timeoutMs ?? DEFAULT_START_TIMEOUT_MS
            )
            return c.json({ sessionId: session.id, machineId, status: deriveAgentStatus(session) })
        } catch (error) {
            return routeFailure(c, error)
        }
    })

    app.post('/api/agent/sessions/:id/prompt', async (c) => {
        try {
            const parsed = AgentPromptRequestSchema.safeParse(await c.req.json().catch(() => null))
            if (!parsed.success) throw new AgentRouteError('bad_args', 'Invalid agent prompt request')
            const engine = requireEngine(getSyncEngine)
            const namespace = c.get('namespace')
            const caller = requireCaller(engine, namespace, parsed.data.caller)
            const target = requireScopedTarget(engine, namespace, caller, c.req.param('id'))
            const initialStatus = deriveAgentStatus(target)
            if (initialStatus === 'dead') throw new AgentRouteError('dead_target', `Target session ${target.id} is inactive`)

            const startedAt = Date.now()
            const localId = randomUUID()
            const consumption = parsed.data.wait && initialStatus !== 'working'
                ? watchMessageConsumption(engine, target.id, localId)
                : null
            try {
                await engine.sendMessage(target.id, {
                    text: parsed.data.text,
                    localId,
                    sentFrom: 'webapp',
                    deliveryMetadata: { fromSessionId: caller.id }
                })
                if (!parsed.data.wait) {
                    return c.json({ sessionId: target.id, status: deriveAgentStatus(target) })
                }
                if (consumption) await requirePromptConsumption(consumption, target.id)
            } catch (error) {
                consumption?.cancel()
                throw error
            }

            const timeoutMs = parsed.data.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
            const remainingMs = timeoutMs - (Date.now() - startedAt)
            if (remainingMs <= 0) throw new AgentRouteError('timeout', `Timed out waiting for session ${target.id}`)
            const until = parsed.data.until
                ? new Set<AgentStatus>([parsed.data.until])
                : new Set<AgentStatus>(['idle', 'blocked'])
            const status = await waitForStatuses(engine, target.id, until, remainingMs)
            return c.json({ sessionId: target.id, status })
        } catch (error) {
            return routeFailure(c, error)
        }
    })

    app.post('/api/agent/sessions/:id/wait', async (c) => {
        try {
            const parsed = AgentWaitRequestSchema.safeParse(await c.req.json().catch(() => null))
            if (!parsed.success) throw new AgentRouteError('bad_args', 'Invalid agent wait request')
            const engine = requireEngine(getSyncEngine)
            const namespace = c.get('namespace')
            const caller = requireCaller(engine, namespace, parsed.data.caller)
            const target = requireScopedTarget(engine, namespace, caller, c.req.param('id'))
            const until = parsed.data.until
                ? new Set<AgentStatus>([parsed.data.until])
                : new Set<AgentStatus>(['idle', 'blocked'])
            const status = await waitForStatuses(
                engine,
                target.id,
                until,
                parsed.data.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
            )
            return c.json({ sessionId: target.id, status })
        } catch (error) {
            return routeFailure(c, error)
        }
    })

    app.post('/api/agent/sessions/:id/stop', async (c) => {
        try {
            const parsed = AgentCallerRequestSchema.safeParse(await c.req.json().catch(() => null))
            if (!parsed.success) throw new AgentRouteError('bad_args', 'Invalid agent stop request')
            const engine = requireEngine(getSyncEngine)
            const namespace = c.get('namespace')
            const caller = requireCaller(engine, namespace, parsed.data.caller)
            const target = requireScopedTarget(engine, namespace, caller, c.req.param('id'))
            if (deriveAgentStatus(target) === 'dead') {
                return c.json({ sessionId: target.id, status: 'dead' as const })
            }
            const machineId = target.metadata?.machineId
            if (!machineId) throw new AgentRouteError('stop_failed', 'Target session has no machine id')
            try {
                await engine.stopSessionOnMachine(machineId, target.id)
            } catch (error) {
                throw new AgentRouteError('stop_failed', error instanceof Error ? error.message : 'Failed to stop target session')
            }
            if (engine.getSession(target.id)?.active) {
                engine.handleSessionEnd({ sid: target.id, time: Date.now(), reason: 'terminated' })
            }
            return c.json({ sessionId: target.id, status: 'dead' as const })
        } catch (error) {
            return routeFailure(c, error)
        }
    })
}
