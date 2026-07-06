import { describe, it, expect } from 'bun:test'
import { createCodexForkClient } from './codexForkClient'

function fakeAppServer(overrides: any = {}) {
    return {
        async forkThread(params: { threadId: string }) {
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
})
