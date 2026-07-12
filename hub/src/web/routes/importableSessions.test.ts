import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { SyncEngine, Machine } from '../../sync/syncEngine'
import type { ImportableSessionAgent, ImportableSessionsResponse } from '@hapi/protocol/apiTypes'
import type { WebAppEnv } from '../middleware/auth'
import { createImportableSessionsRoutes } from './importableSessions'

const machine: Machine = {
    id: 'machine-1', namespace: 'default', seq: 0, createdAt: 0, updatedAt: 0, active: true, activeAt: 0,
    metadata: { host: 'test', platform: 'darwin', happyCliVersion: 'test', workspaceRoots: ['/work'] }, metadataVersion: 1,
    runnerState: null, runnerStateVersion: 1
}

function app(engine: SyncEngine): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => { c.set('namespace', 'default'); await next() })
    app.route('/api', createImportableSessionsRoutes(() => engine))
    return app
}

function fakeEngine(overrides: Partial<SyncEngine> = {}): SyncEngine {
    return {
        getMachine: () => machine,
        getSessionsByNamespace: () => [],
        listImportableSessionsForMachine: async (_machineId: string, agent: ImportableSessionAgent) => ({ sessions: [{
            agent, externalSessionId: 'external-1', cwd: '/work', timestamp: 1,
            previewTitle: 'Imported title', previewPrompt: 'hello', messageCount: 2, cliVersion: '1'
        }], nextCursor: null }),
        resolveImportableSessionForMachine: async (_machineId: string, agent: ImportableSessionAgent, externalSessionId: string) => ({
            type: 'success',
            session: { agent, externalSessionId, cwd: '/work', timestamp: 1, previewTitle: 'Imported title', previewPrompt: 'hello', messageCount: 2, cliVersion: '1' },
            transcriptPath: '/private/transcript.jsonl'
        }),
        spawnSession: async () => ({ type: 'success', sessionId: 'hapi-1' }),
        waitForSessionActive: async () => true,
        waitForImportHistoryComplete: async () => 'complete',
        archiveSession: async () => {},
        renameSession: async () => {},
        ...overrides
    } as unknown as SyncEngine
}

describe('importable session routes', () => {
    it('resumes the selected provider session on its machine', async () => {
        const calls: unknown[][] = []
        let renamed: unknown[] | null = null
        const engine = fakeEngine({
            spawnSession: async (...args: unknown[]) => { calls.push(args); return { type: 'success', sessionId: 'hapi-1' } },
            renameSession: async (...args: unknown[]) => { renamed = args }
        } as Partial<SyncEngine>)
        const response = await app(engine).request('/api/machines/machine-1/importable-sessions/codex/external-1/import', { method: 'POST' })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ type: 'success', sessionId: 'hapi-1', alreadyImported: false })
        expect(calls).toHaveLength(1)
        expect(calls[0].slice(0, 3)).toEqual(['machine-1', '/work', 'codex'])
        expect(calls[0][8]).toBe('external-1')
        expect(calls[0].slice(-3)).toEqual([true, '/private/transcript.jsonl', false])
        expect(renamed as unknown).toEqual(['hapi-1', 'Imported title'])
    })

    it('returns the existing Hapi session without spawning a duplicate', async () => {
        let spawned = false
        const engine = fakeEngine({
            getSessionsByNamespace: () => [{ id: 'existing', metadata: { flavor: 'claude', claudeSessionId: 'external-1', importHistoryState: 'complete' } }] as never,
            spawnSession: async () => { spawned = true; return { type: 'success', sessionId: 'unexpected' } }
        })
        const response = await app(engine).request('/api/machines/machine-1/importable-sessions/claude/external-1/import', { method: 'POST' })
        expect(await response.json()).toEqual({ type: 'success', sessionId: 'existing', alreadyImported: true })
        expect(spawned).toBe(false)
    })

    it('rejects unknown provider sessions instead of spawning arbitrary resume ids', async () => {
        let spawned = false
        const engine = fakeEngine({
            resolveImportableSessionForMachine: async () => ({ type: 'error', error: 'not listed' }),
            spawnSession: async () => { spawned = true; return { type: 'success', sessionId: 'unexpected' } }
        })
        const response = await app(engine).request('/api/machines/machine-1/importable-sessions/codex/missing/import', { method: 'POST' })
        expect(response.status).toBe(404)
        expect(spawned).toBe(false)
    })

    it('waits for history replay completion before returning success', async () => {
        let replayWaited = false
        const engine = fakeEngine({
            waitForImportHistoryComplete: async () => { replayWaited = true; return 'complete' }
        } as Partial<SyncEngine>)
        const response = await app(engine).request('/api/machines/machine-1/importable-sessions/codex/external-1/import', { method: 'POST' })
        expect(response.status).toBe(200)
        expect(replayWaited).toBe(true)
    })

    it('archives an ended partial import and retries instead of returning it as complete', async () => {
        let archived: string | null = null
        let spawned = false
        let waits = 0
        const engine = fakeEngine({
            getSessionsByNamespace: () => [{ id: 'partial', active: false, metadata: { flavor: 'codex', codexSessionId: 'external-1', importHistoryState: 'replaying' } }] as never,
            waitForImportHistoryComplete: async () => (++waits === 1 ? 'ended' : 'complete'),
            archiveSession: async (sessionId: string) => { archived = sessionId },
            spawnSession: async () => { spawned = true; return { type: 'success', sessionId: 'retry' } }
        } as Partial<SyncEngine>)
        const response = await app(engine).request('/api/machines/machine-1/importable-sessions/codex/external-1/import', { method: 'POST' })
        expect(response.status).toBe(200)
        expect(archived as string | null).toBe('partial')
        expect(spawned).toBe(true)
    })

    it('allows imports on runners without configured workspace roots', async () => {
        const unscopedMachine = { ...machine, metadata: { ...machine.metadata!, workspaceRoots: undefined } }
        const engine = fakeEngine({ getMachine: () => unscopedMachine } as Partial<SyncEngine>)
        const listed = await app(engine).request('/api/machines/machine-1/importable-sessions?agent=codex')
        expect(((await listed.json()) as ImportableSessionsResponse).sessions).toHaveLength(1)
        const imported = await app(engine).request('/api/machines/machine-1/importable-sessions/codex/external-1/import', { method: 'POST' })
        expect(imported.status).toBe(200)
    })

    it('serializes concurrent imports of the same provider session', async () => {
        let completed = false
        let spawnCount = 0
        const engine = fakeEngine({
            getSessionsByNamespace: () => completed
                ? [{ id: 'hapi-1', metadata: { flavor: 'codex', codexSessionId: 'external-1', importHistoryState: 'complete' } }] as never
                : [],
            spawnSession: async () => { spawnCount += 1; return { type: 'success', sessionId: 'hapi-1' } },
            renameSession: async () => { completed = true }
        } as Partial<SyncEngine>)
        const testApp = app(engine)
        const [first, second] = await Promise.all([
            testApp.request('/api/machines/machine-1/importable-sessions/codex/external-1/import', { method: 'POST' }),
            testApp.request('/api/machines/machine-1/importable-sessions/codex/external-1/import', { method: 'POST' })
        ])
        expect(spawnCount).toBe(1)
        expect(await first.json()).toEqual({ type: 'success', sessionId: 'hapi-1', alreadyImported: false })
        expect(await second.json()).toEqual({ type: 'success', sessionId: 'hapi-1', alreadyImported: true })
    })

    it('does not treat archived or non-import resumes as completed imports', async () => {
        const engine = fakeEngine({
            getSessionsByNamespace: () => [{ id: 'archived', active: false, metadata: { flavor: 'codex', codexSessionId: 'external-1', importHistoryState: 'complete', archivedAt: 1 } }] as never
        } as Partial<SyncEngine>)
        const listed = await app(engine).request('/api/machines/machine-1/importable-sessions?agent=codex')
        expect(((await listed.json()) as ImportableSessionsResponse).sessions[0].alreadyImported).toBe(false)
    })

    it('does not archive an active normal resume when full history was never imported', async () => {
        let archived = false
        const engine = fakeEngine({
            getSessionsByNamespace: () => [{ id: 'normal', active: true, metadata: { flavor: 'claude', claudeSessionId: 'external-1' } }] as never,
            archiveSession: async () => { archived = true }
        } as Partial<SyncEngine>)
        const response = await app(engine).request('/api/machines/machine-1/importable-sessions/claude/external-1/import', { method: 'POST' })
        expect(response.status).toBe(409)
        expect(archived).toBe(false)
    })
})
