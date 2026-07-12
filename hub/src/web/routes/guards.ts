import type { Context } from 'hono'
import type { Machine, Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import type { Store } from '../../store'
import { authorizeResource as authorizeAccountResource } from '../../auth/access'

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
    const result = authorizeAccountResource({
        store, accountId: c.get('accountId'), namespace: c.get('namespace'),
        resourceType, resourceId, capability: requireOperate ? 'operate' : 'read'
    })
    const label = resourceType === 'machine' ? 'Machine' : 'Session'
    if (!result.ok && result.reason !== 'insufficient-access') {
        return c.json({ error: `${label} access denied` }, 403)
    }
    return result.ok ? null : c.json({ error: requireOperate ? 'Insufficient permissions' : `${label} access denied` }, 403)
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
        // `code` lets the web client discriminate the inactive-session 409 from
        // other 4xx without string-matching the human message (which is i18n'd
        // by the consumer and may change).  See web onError handler in
        // router.tsx which surfaces a Reopen affordance on this code.
        return c.json({ error: 'Session is inactive', code: 'session_inactive' }, 409)
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
