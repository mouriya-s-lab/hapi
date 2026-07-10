import { describe, it, expect } from 'bun:test'
import { createCodexForkClient } from './codexForkClient'

function fakeAppServer(overrides: any = {}) {
    return {
        async forkThread(params: { threadId: string; numTurns?: number }) {
            overrides.forkCalls?.push(params)
            return overrides.forkResp ?? { thread: { id: `forked-${params.threadId}` } }
        },
        async resumeThread(params: { threadId: string }) {
            overrides.resumeCalls?.push(params.threadId)
            return overrides.resumeResp ?? { thread: { id: params.threadId }, model: 'x' }
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

    it('forkThread forwards numTurns to app-server (per-message fork)', async () => {
        const forkCalls: Array<{ threadId: string; numTurns?: number }> = []
        const client = createCodexForkClient(fakeAppServer({ forkCalls }))
        await client.forkThread({ threadId: 'src', numTurns: 3 })
        expect(forkCalls).toEqual([{ threadId: 'src', numTurns: 3 }])
    })

    it('forkThread omits numTurns when not provided (HEAD fork, backward-compat)', async () => {
        const forkCalls: Array<{ threadId: string; numTurns?: number }> = []
        const client = createCodexForkClient(fakeAppServer({ forkCalls }))
        await client.forkThread({ threadId: 'src' })
        expect(forkCalls).toHaveLength(1)
        expect(forkCalls[0].threadId).toBe('src')
        expect(forkCalls[0].numTurns).toBeUndefined()
    })
})
