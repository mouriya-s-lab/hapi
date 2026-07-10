import { describe, it, expect } from 'bun:test'
import { createCodexForkClient } from './codexForkClient'

function fakeAppServer(overrides: any = {}) {
    return {
        async forkThread(params: { threadId: string; lastTurnId?: string }) {
            overrides.forkCalls?.push(params)
            return overrides.forkResp ?? { thread: { id: `forked-${params.threadId}` } }
        },
        async resumeThread(params: { threadId: string }) {
            overrides.resumeCalls?.push(params.threadId)
            return overrides.resumeResp ?? { thread: { id: params.threadId }, model: 'x' }
        },
        async readThread() {
            return { thread: { turns: overrides.turns ?? [] } }
        },
        async rollbackThread(params: { threadId: string; numTurns: number }) {
            overrides.rollbackCalls?.push(params)
            return { thread: { id: params.threadId } }
        }
    } as any
}

describe('createCodexForkClient', () => {
    it('extracts newThreadId from response.thread.id', async () => {
        const client = createCodexForkClient(fakeAppServer())
        const result = await client.forkThread({ threadId: 'src' })
        expect(result.newThreadId).toBe('forked-src')
    })

    it('throws if app-server omits thread.id', async () => {
        const client = createCodexForkClient(fakeAppServer({ forkResp: { thread: {} } }))
        await expect(client.forkThread({ threadId: 'src' })).rejects.toThrow(/thread\.id/)
    })

    it('throws if app-server returns empty thread.id', async () => {
        const client = createCodexForkClient(fakeAppServer({ forkResp: { thread: { id: '' } } }))
        await expect(client.forkThread({ threadId: 'src' })).rejects.toThrow(/thread\.id/)
    })

    it('resumeThread forwards threadId', async () => {
        const resumeCalls: string[] = []
        const client = createCodexForkClient(fakeAppServer({ resumeCalls }))
        await client.resumeThread({ threadId: 't1' })
        expect(resumeCalls).toEqual(['t1'])
    })

    it('per-message fork resolves the previous turn to lastTurnId', async () => {
        const forkCalls: Array<{ threadId: string; lastTurnId?: string }> = []
        const turns = ['t1', 't2', 't3', 't4'].map((id) => ({ id }))
        const client = createCodexForkClient(fakeAppServer({ forkCalls, turns }))
        await client.forkThread({ threadId: 'src', tailOffset: 1 })
        expect(forkCalls).toEqual([{ threadId: 'src', lastTurnId: 't3' }])
    })

    it('first-message rewind forks through the first turn then rolls it back', async () => {
        const forkCalls: Array<{ threadId: string; lastTurnId?: string }> = []
        const rollbackCalls: Array<{ threadId: string; numTurns: number }> = []
        const client = createCodexForkClient(fakeAppServer({ forkCalls, rollbackCalls, turns: [{ id: 't1' }] }))
        const result = await client.forkThread({
            threadId: 'src',
            tailOffset: 0
        })
        expect(forkCalls).toEqual([{ threadId: 'src', lastTurnId: 't1' }])
        expect(rollbackCalls).toEqual([{ threadId: 'forked-src', numTurns: 1 }])
        expect(result.newThreadId).toBe('forked-src')
    })

    it('forkThread omits lastTurnId when no rewind point is provided', async () => {
        const forkCalls: Array<{ threadId: string; lastTurnId?: string }> = []
        const client = createCodexForkClient(fakeAppServer({ forkCalls }))
        await client.forkThread({ threadId: 'src' })
        expect(forkCalls).toHaveLength(1)
        expect(forkCalls[0].threadId).toBe('src')
        expect(forkCalls[0].lastTurnId).toBeUndefined()
    })
})
