import type { Context } from 'hono'
import type { Machine, Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import type { Store } from '../../store'
import { canOperate, canRead, resolveAccessLevel, type AccessLevel } from '../../auth/access'

export function requireSyncEngine(
    c: Context<WebAppEnv>,
    getSyncEngine: () => SyncEngine | null
): SyncEngine | Response {
    const engine = getSyncEngine()
    if (!engine) {
        return c.json({ error: 'Not connected' }, 503)
    }
    return engine
}

/**
 * Authorize the current account against a resource's ownership/grant, on top of
 * the namespace check the caller already passed. Ownership is read from the
 * store (the cached protocol Session/Machine objects don't carry it).
 *
 * When `store` is not provided (older call sites that haven't opted in yet),
 * this is a no-op and only the namespace check applies — preserving existing
 * single-user behaviour until every route is migrated.
 */
function authorizeResource(
    c: Context<WebAppEnv>,
    store: Store | null | undefined,
    resourceType: 'machine' | 'session',
    resourceId: string,
    requireOperate: boolean
): Response | null {
    if (!store) {
        return null
    }
    const ownerAccountId = resourceType === 'machine'
        ? store.machines.getMachine(resourceId)?.ownerAccountId ?? null
        : store.sessions.getSession(resourceId)?.ownerAccountId ?? null

    const accountId = c.get('accountId')
    const role = c.get('role') ?? 'user'
    const level: AccessLevel = resolveAccessLevel({
        store,
        accountId,
        role,
        resourceType,
        resourceId,
        ownerAccountId
    })
    const label = resourceType === 'machine' ? 'Machine' : 'Session'
    if (!canRead(level)) {
        return c.json({ error: `${label} access denied` }, 403)
    }
    if (requireOperate && !canOperate(level)) {
        return c.json({ error: 'Insufficient permissions' }, 403)
    }
    return null
}

export function requireSession(
    c: Context<WebAppEnv>,
    engine: SyncEngine,
    sessionId: string,
    options?: { requireActive?: boolean; store?: Store | null; requireOperate?: boolean }
): { sessionId: string; session: Session } | Response {
    const namespace = c.get('namespace')
    const access = engine.resolveSessionAccess(sessionId, namespace)
    if (!access.ok) {
        const status = access.reason === 'access-denied' ? 403 : 404
        const error = access.reason === 'access-denied' ? 'Session access denied' : 'Session not found'
        return c.json({ error }, status)
    }
    const authzError = authorizeResource(c, options?.store, 'session', access.sessionId, options?.requireOperate ?? false)
    if (authzError) {
        return authzError
    }
    if (options?.requireActive && !access.session.active) {
        return c.json({ error: 'Session is inactive' }, 409)
    }
    return { sessionId: access.sessionId, session: access.session }
}

export function requireSessionFromParam(
    c: Context<WebAppEnv>,
    engine: SyncEngine,
    options?: { paramName?: string; requireActive?: boolean; store?: Store | null; requireOperate?: boolean }
): { sessionId: string; session: Session } | Response {
    const paramName = options?.paramName ?? 'id'
    const sessionId = c.req.param(paramName)
    const result = requireSession(c, engine, sessionId, {
        requireActive: options?.requireActive,
        store: options?.store,
        requireOperate: options?.requireOperate
    })
    if (result instanceof Response) {
        return result
    }
    return result
}

export function requireMachine(
    c: Context<WebAppEnv>,
    engine: SyncEngine,
    machineId: string,
    options?: { store?: Store | null; requireOperate?: boolean }
): Machine | Response {
    const namespace = c.get('namespace')
    const machine = engine.getMachine(machineId)
    if (!machine) {
        return c.json({ error: 'Machine not found' }, 404)
    }
    if (machine.namespace !== namespace) {
        return c.json({ error: 'Machine access denied' }, 403)
    }
    const authzError = authorizeResource(c, options?.store, 'machine', machine.id, options?.requireOperate ?? false)
    if (authzError) {
        return authzError
    }
    return machine
}
