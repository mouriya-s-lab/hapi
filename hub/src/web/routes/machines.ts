import {
    MachineCreateDirectoryRequestSchema,
    MachineListDirectoryRequestSchema,
    MachinePathsExistsRequestSchema,
    SpawnSessionRequestSchema
} from '@hapi/protocol'
import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import type { Store } from '../../store'
import { requireMachine } from './guards'

export function createMachinesRoutes(
    getSyncEngine: () => SyncEngine | null,
    getStore?: () => Store | null
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // Bind the live store into requireMachine so ownership/grant authorization
    // runs on top of the namespace check. requireOperate gates write/spawn.
    const guardMachine = (c: Parameters<typeof requireMachine>[0], engine: SyncEngine, machineId: string, requireOperate = false) =>
        requireMachine(c, engine, machineId, { store: getStore?.() ?? null, requireOperate })

    app.get('/machines', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const namespace = c.get('namespace')
        const role = c.get('role') ?? 'user'
        const accountId = c.get('accountId')
        const store = getStore?.() ?? null

        let machines = engine.getOnlineMachinesByNamespace(namespace)
        // Non-admins only see machines they own or have been granted.
        if (store && role !== 'admin') {
            const allowed = new Set<string>([
                ...store.machines.getMachinesForAccount(namespace, accountId).map((m) => m.id)
            ])
            machines = machines.filter((m) => allowed.has(m.id))
        }
        return c.json({ machines })
    })

    app.post('/machines/:id/spawn', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = guardMachine(c, engine, machineId, true)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = SpawnSessionRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const result = await engine.spawnSession(
            machineId,
            parsed.data.directory,
            parsed.data.agent,
            parsed.data.model,
            parsed.data.modelReasoningEffort,
            parsed.data.yolo,
            parsed.data.sessionType,
            parsed.data.worktreeName,
            undefined,
            parsed.data.effort
        )
        if (result.type === 'success') {
            // The spawned CLI registered the session under the machine
            // daemon's token account. The account that clicked "spawn" owns
            // the conversation — without this, an operator-grantee spawning
            // on someone else's machine cannot see the session they created.
            const accountId = c.get('accountId')
            if (typeof accountId === 'number') {
                engine.assignSessionOwner(result.sessionId, accountId)
            }
        }
        return c.json(result)
    })

    app.post('/machines/:id/list-directory', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = guardMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = MachineListDirectoryRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const result = await engine.listMachineDirectory(machineId, parsed.data.path)
            return c.json(result)
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to list directory' }, 500)
        }
    })

    app.post('/machines/:id/create-directory', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = MachineCreateDirectoryRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            return c.json(await engine.createMachineDirectory(
                machineId,
                parsed.data.parentPath,
                parsed.data.name
            ))
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to create directory' }, 500)
        }
    })

    app.post('/machines/:id/paths/exists', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = guardMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = MachinePathsExistsRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const uniquePaths = Array.from(new Set(parsed.data.paths.map((path) => path.trim()).filter(Boolean)))
        if (uniquePaths.length === 0) {
            return c.json({ exists: {} })
        }

        try {
            const exists = await engine.checkPathsExist(machineId, uniquePaths)
            return c.json({ exists })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to check paths' }, 500)
        }
    })

    app.get('/machines/:id/codex-models', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ success: false, error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = guardMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        try {
            const result = await engine.listCodexModelsForMachine(machineId)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list Codex models'
            }, 500)
        }
    })

    app.get('/machines/:id/opencode-models', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ success: false, error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = guardMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const cwd = (c.req.query('cwd') ?? '').trim()
        if (!cwd) {
            return c.json({ success: false, error: 'cwd query parameter is required' }, 400)
        }

        try {
            const result = await engine.listOpencodeModelsForCwd(machineId, cwd)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list OpenCode models'
            }, 500)
        }
    })

    app.get('/machines/:id/cursor-models', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ success: false, error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = guardMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        try {
            const result = await engine.listCursorModelsForMachine(machineId)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list Cursor models'
            }, 500)
        }
    })

    app.get('/machines/:id/cc-switch/providers', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ success: false, error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = guardMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        try {
            const result = await engine.listCcSwitchProvidersForMachine(machineId)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list cc-switch providers'
            }, 500)
        }
    })

    app.post('/machines/:id/cc-switch/switch', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ success: false, error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = guardMachine(c, engine, machineId, true)
        if (machine instanceof Response) {
            return machine
        }

        let providerId = ''
        try {
            const body = await c.req.json()
            providerId = typeof body?.providerId === 'string' ? body.providerId : ''
        } catch {
            return c.json({ success: false, error: 'Invalid request body' }, 400)
        }
        if (!providerId) {
            return c.json({ success: false, error: 'providerId is required' }, 400)
        }

        try {
            const result = await engine.switchCcSwitchProviderForMachine(machineId, providerId)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to switch cc-switch provider'
            }, 500)
        }
    })

    app.get('/machines/:id/cc-switch/usage', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ success: false, error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = guardMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const providerId = (c.req.query('providerId') ?? '').trim() || undefined

        try {
            const result = await engine.queryCcSwitchUsageForMachine(machineId, providerId)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to query cc-switch usage'
            }, 500)
        }
    })

    return app
}
