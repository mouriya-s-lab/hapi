import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import type { SyncEngine } from '../../hub/src/sync/syncEngine'
import type { WebAppEnv } from '../../hub/src/web/middleware/auth'
import { mountAgentSkillRoutes } from './hubRoutes'

describe('agent skill machine routes', () => {
    it('probes only a machine in the authenticated namespace', async () => {
        const getMachineByNamespace = vi.fn((id: string, namespace: string) =>
            id === 'machine-1' && namespace === 'alpha' ? { id } : undefined)
        const result = { agentSkills: { canonicalHash: 'hash', cliVersion: '1.0.0', checkedAt: 1, harnesses: {} } }
        const probeMachineAgentSkills = vi.fn(async () => result)
        const engine = { getMachineByNamespace, probeMachineAgentSkills } as unknown as SyncEngine
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'alpha')
            await next()
        })
        mountAgentSkillRoutes(app, () => engine)

        const denied = await app.request('/api/machines/inaccessible/agent-skills/refresh', { method: 'POST' })
        expect(denied.status).toBe(404)
        expect(await denied.json()).toEqual({ error: 'Machine not found' })
        expect(probeMachineAgentSkills).not.toHaveBeenCalled()

        const response = await app.request('/api/machines/machine-1/agent-skills/refresh', { method: 'POST' })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(result)
        expect(probeMachineAgentSkills.mock.calls).toEqual([['machine-1']])
    })
})
