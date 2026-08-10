/** Relays Settings refreshes to the runner's read-only probe RPC. */
import type { Hono } from 'hono'

import type { SyncEngine } from '../../hub/src/sync/syncEngine'
import type { WebAppEnv } from '../../hub/src/web/middleware/auth'

export function mountAgentSkillRoutes(
    app: Hono<WebAppEnv>,
    getSyncEngine: () => SyncEngine | null
): void {
    app.post('/api/machines/:id/agent-skills/refresh', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const namespace = c.get('namespace')
        const machineId = c.req.param('id')
        if (!engine.getMachineByNamespace(machineId, namespace)) {
            return c.json({ error: 'Machine not found' }, 404)
        }

        try {
            const result = await engine.probeMachineAgentSkills(machineId)
            return c.json(result)
        } catch (error) {
            console.error(`[agent-skill-probe] machine ${machineId} probe failed`, error)
            return c.json({ error: 'Agent skills probe failed' }, 502)
        }
    })
}
