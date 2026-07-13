import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import { createConfiguration } from '../../configuration'
import { createCliRoutes } from './cli'
import { Store } from '../../store'
import { bootstrapMultiUser } from '../../auth/bootstrap'
import { initAuthContext } from '../../auth/authContext'
import { generateApiToken, hashApiToken } from '../../utils/apiToken'

let store: Store
let sessionId: string
let ownerSessionId: string
let strangerSessionId: string
let ownerToken: string
let strangerToken: string
import { SessionIdentityConflictError } from '../../store/sessions'

function createApp(engine: Partial<SyncEngine>) {
    const app = new Hono()
    const fullEngine = {
        resolveSessionAccess: (sessionId: string, namespace: string) => ({
            ok: true as const,
            sessionId,
            session: { id: sessionId, namespace }
        }),
        ...engine
    } as SyncEngine
    app.route('/cli', createCliRoutes(() => fullEngine, store))
    return app
}

function authHeaders() {
    return {
        authorization: 'Bearer test-token'
    }
}

function tokenHeaders(token: string) {
    return { authorization: `Bearer ${token}` }
}

beforeAll(async () => {
    const config = await createConfiguration()
    config._setCliApiToken('test-token', 'env', false)
    // Initialize the multi-user auth context so the shared token resolves to
    // the bootstrap admin (resolveAuth returns null without this).
    store = new Store(':memory:')
    const boot = bootstrapMultiUser(store, 'test-token')
    initAuthContext(store, boot.legacyAdminAccountId)
    sessionId = store.sessions.getOrCreateSession(
        'session-1', {}, null, 'default', undefined, undefined, undefined, undefined, boot.legacyAdminAccountId
    ).id
    const owner = store.accounts.create({ username: 'owner', passwordHash: null, role: 'user', defaultNamespace: 'default' })
    const stranger = store.accounts.create({ username: 'stranger', passwordHash: null, role: 'user', defaultNamespace: 'default' })
    ownerToken = generateApiToken()
    strangerToken = generateApiToken()
    store.apiTokens.create({ accountId: owner.id, name: 'owner', tokenHash: hashApiToken(ownerToken), namespace: 'default' })
    store.apiTokens.create({ accountId: stranger.id, name: 'stranger', tokenHash: hashApiToken(strangerToken), namespace: 'default' })
    ownerSessionId = store.sessions.getOrCreateSession(
        'owner-session', {}, null, 'default', undefined, undefined, undefined, undefined, owner.id
    ).id
    strangerSessionId = store.sessions.getOrCreateSession(
        'stranger-session', {}, null, 'default', undefined, undefined, undefined, undefined, stranger.id
    ).id
})

describe('cli resume routes', () => {
    it('rejects loading an existing same-namespace session owned by another account', async () => {
        const existing = store.sessions.getSession(ownerSessionId)
        if (!existing) throw new Error('owner session missing')
        const app = createApp({
            getOrCreateSession: () => ({ ...existing, id: ownerSessionId })
        } as never)

        const response = await app.request('/cli/sessions', {
            method: 'POST',
            headers: { ...tokenHeaders(strangerToken), 'content-type': 'application/json' },
            body: JSON.stringify({ tag: 'owner-session', metadata: {} })
        })

        expect(response.status).toBe(403)
    })

    it('filters resumable sessions by account ownership and grants', async () => {
        const app = createApp({
            listLocalResumableSessions: () => [ownerSessionId, strangerSessionId].map((id) => ({
                sessionId: id,
                flavor: 'codex' as const,
                directory: '/tmp/project',
                active: false,
                thinking: false,
                controlledByUser: false,
                agentSessionId: `thread-${id}`,
                updatedAt: 123
            }))
        })

        const response = await app.request('/cli/sessions/resumable', { headers: tokenHeaders(ownerToken) })

        expect(response.status).toBe(200)
        const body = await response.json() as { sessions: Array<{ sessionId: string }> }
        expect(body.sessions.map((session) => session.sessionId)).toEqual([ownerSessionId])
    })

    it('rejects same-namespace CLI reads and resume operations without resource access', async () => {
        const app = createApp({
            resolveLocalResumeTarget: () => ({
                type: 'success' as const,
                target: {
                    sessionId: ownerSessionId,
                    flavor: 'codex' as const,
                    directory: '/tmp/project',
                    active: false,
                    thinking: false,
                    controlledByUser: false,
                    agentSessionId: 'owner-thread'
                }
            })
        })

        const readResponse = await app.request(`/cli/sessions/${ownerSessionId}`, {
            headers: tokenHeaders(strangerToken)
        })
        const resumeResponse = await app.request(`/cli/sessions/${ownerSessionId}/resume-target`, {
            headers: tokenHeaders(strangerToken)
        })

        expect(readResponse.status).toBe(403)
        expect(resumeResponse.status).toBe(403)
    })

    it('returns local resumable sessions', async () => {
        const app = createApp({
            listLocalResumableSessions: () => [{
                sessionId,
                flavor: 'codex',
                directory: '/tmp/project',
                machineId: 'machine-1',
                active: false,
                thinking: false,
                controlledByUser: false,
                agentSessionId: 'codex-thread-1',
                updatedAt: 123
            }]
        } as never)

        const response = await app.request('/cli/sessions/resumable?machineId=machine-1', {
            headers: authHeaders()
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            sessions: [{
                sessionId,
                flavor: 'codex',
                directory: '/tmp/project',
                machineId: 'machine-1',
                active: false,
                thinking: false,
                controlledByUser: false,
                agentSessionId: 'codex-thread-1',
                updatedAt: 123
            }]
        })
    })

    it('returns a local resume target', async () => {
        const app = createApp({
            resolveLocalResumeTarget: () => ({
                type: 'success',
                target: {
                    sessionId,
                    flavor: 'claude',
                    directory: '/tmp/project',
                    machineId: 'machine-1',
                    active: false,
                    thinking: false,
                    controlledByUser: false,
                    agentSessionId: '11111111-1111-4111-8111-111111111111'
                }
            })
        } as never)

        const response = await app.request(`/cli/sessions/${sessionId}/resume-target`, {
            headers: authHeaders()
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            target: {
                sessionId,
                flavor: 'claude',
                directory: '/tmp/project',
                machineId: 'machine-1',
                active: false,
                thinking: false,
                controlledByUser: false,
                agentSessionId: '11111111-1111-4111-8111-111111111111'
            }
        })
    })

    it('returns handoff errors with status codes', async () => {
        const app = createApp({
            handoffSessionToLocal: async () => ({
                type: 'error',
                message: 'Session is already controlled by a local terminal',
                code: 'already_local'
            })
        } as never)

        const response = await app.request(`/cli/sessions/${sessionId}/handoff-local`, {
            method: 'POST',
            headers: authHeaders()
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Session is already controlled by a local terminal',
            code: 'already_local'
        })
    })
})

describe('cli lazy session creation', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111'

    it('creates the machine and requested session identity in one request', async () => {
        const getOrCreateMachine = mock(() => ({ id: 'machine-1' }))
        const adminId = store.accounts.list().find((account) => account.role === 'admin')?.id
        if (adminId === undefined) throw new Error('bootstrap admin missing')
        const getOrCreateSession = mock((...args: Parameters<SyncEngine['getOrCreateSession']>) =>
            store.sessions.getOrCreateSession(...args))
        const app = createApp({
            getMachine: () => null,
            getOrCreateMachine,
            getOrCreateSession
        } as never)

        const response = await app.request('/cli/sessions', {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                id: sessionId,
                tag: 'lazy-tag',
                metadata: { path: '/tmp/project' },
                agentState: { controlledByUser: true },
                machine: {
                    id: 'machine-1',
                    metadata: { host: 'localhost' }
                }
            })
        })

        expect(response.status).toBe(200)
        expect(getOrCreateMachine).toHaveBeenCalledWith(
            'machine-1',
            { host: 'localhost' },
            null,
            'default',
            adminId
        )
        expect(getOrCreateSession).toHaveBeenCalledWith(
            'lazy-tag',
            { path: '/tmp/project' },
            { controlledByUser: true },
            'default',
            undefined,
            undefined,
            undefined,
            sessionId,
            adminId
        )
    })

    it('rejects an embedded machine owned by another namespace', async () => {
        const getOrCreateMachine = mock(() => ({ id: 'machine-1' }))
        const getOrCreateSession = mock(() => ({ id: sessionId }))
        const app = createApp({
            getMachine: () => ({ id: 'machine-1', namespace: 'other' }),
            getMachineByNamespace: () => null,
            getOrCreateMachine,
            getOrCreateSession
        } as never)

        const response = await app.request('/cli/sessions', {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                id: sessionId,
                tag: 'lazy-tag',
                metadata: {},
                machine: { id: 'machine-1', metadata: {} }
            })
        })

        expect(response.status).toBe(403)
        expect(getOrCreateMachine).not.toHaveBeenCalled()
        expect(getOrCreateSession).not.toHaveBeenCalled()
    })

    it('rejects a same-namespace session that references another account machine', async () => {
        const owner = store.accounts.getByUsername('owner')
        if (!owner) throw new Error('owner account missing')
        const machine = store.machines.getOrCreateMachine('owner-machine', {}, null, 'default', owner.id)
        const getOrCreateSession = mock(() => ({ id: sessionId }))
        const app = createApp({
            getMachine: (id: string) => id === machine.id ? machine : null,
            getMachineByNamespace: (id: string, namespace: string) =>
                id === machine.id && namespace === machine.namespace ? machine : null,
            getOrCreateSession
        } as never)

        const response = await app.request('/cli/sessions', {
            method: 'POST',
            headers: { ...tokenHeaders(strangerToken), 'content-type': 'application/json' },
            body: JSON.stringify({
                id: sessionId,
                tag: 'foreign-machine-session',
                metadata: { machineId: machine.id }
            })
        })

        expect(response.status).toBe(403)
        expect(getOrCreateSession).not.toHaveBeenCalled()
    })

    it('allows an operator to create a session on a granted machine', async () => {
        const owner = store.accounts.getByUsername('owner')
        const stranger = store.accounts.getByUsername('stranger')
        if (!owner || !stranger) throw new Error('test accounts missing')
        const machine = store.machines.getOrCreateMachine('granted-machine', {}, null, 'default', owner.id)
        store.grants.upsert({ resourceType: 'machine', resourceId: machine.id, granteeAccountId: stranger.id, role: 'operator' })
        const getOrCreateSession = mock((...args: Parameters<SyncEngine['getOrCreateSession']>) =>
            store.sessions.getOrCreateSession(...args))
        const app = createApp({
            getMachine: (id: string) => id === machine.id ? machine : null,
            getMachineByNamespace: (id: string, namespace: string) =>
                id === machine.id && namespace === machine.namespace ? machine : null,
            getOrCreateSession
        } as never)

        const response = await app.request('/cli/sessions', {
            method: 'POST',
            headers: { ...tokenHeaders(strangerToken), 'content-type': 'application/json' },
            body: JSON.stringify({
                tag: 'granted-machine-session',
                metadata: { machineId: machine.id }
            })
        })

        expect(response.status).toBe(200)
        expect(getOrCreateSession).toHaveBeenCalled()
    })

    it('returns 409 for a requested identity conflict', async () => {
        const app = createApp({
            getOrCreateSession: () => {
                throw new SessionIdentityConflictError('Session tag is already bound to a different id')
            }
        })

        const response = await app.request('/cli/sessions', {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                id: sessionId,
                tag: 'lazy-tag',
                metadata: {}
            })
        })

        expect(response.status).toBe(409)
    })
})
