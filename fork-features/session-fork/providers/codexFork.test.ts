import { describe, it, expect } from 'bun:test'
import { createCodexForkProvider, type CodexForkClient } from './codexFork'

function makeClient(overrides: Partial<CodexForkClient> = {}): CodexForkClient {
    return {
        async forkThread({ threadId }) {
            return { newThreadId: `forked-${threadId}` }
        },
        async resumeThread() {
            return undefined
        },
        ...overrides
    }
}

describe('codexForkProvider (factory)', () => {
    it('calls thread/fork then thread/resume with the forked id', async () => {
        const calls: string[] = []
        const client = makeClient({
            async forkThread({ threadId }) {
                calls.push(`fork:${threadId}`)
                return { newThreadId: 'forked-thread' }
            },
            async resumeThread({ threadId }) {
                calls.push(`resume:${threadId}`)
                return undefined
            }
        })
        const provider = createCodexForkProvider(() => client)
        const result = await provider.spawnFork({
            sourceMetadata: { path: '/w', host: 'h', codexSessionId: 'src-thread' },
            sourceCwd: '/tmp/work',
        } as any)
        expect(calls).toEqual(['fork:src-thread', 'resume:forked-thread'])
        expect(result.providerSessionId).toBe('forked-thread')
        expect(result.metadataPatch.codexSessionId).toBe('forked-thread')
    })

    it('prefers codexSessionId from sourceMetadata when present', async () => {
        const calls: string[] = []
        const client = makeClient({
            async forkThread({ threadId }) {
                calls.push(`fork:${threadId}`)
                return { newThreadId: 'nt' }
            }
        })
        const provider = createCodexForkProvider(() => client)
        await provider.spawnFork({
            sourceMetadata: { path: '/w', host: 'h', codexSessionId: 'src-cs' },
            sourceCwd: '/w',
        } as any)
        expect(calls[0]).toBe('fork:src-cs')
    })

    it('awaits async client factory before calling', async () => {
        let factoryCalled = 0
        const provider = createCodexForkProvider(async () => {
            factoryCalled++
            return makeClient()
        })
        await provider.spawnFork({
            sourceMetadata: { path: '/w', host: 'h', codexSessionId: 's' },
            sourceCwd: '/w',
        } as any)
        expect(factoryCalled).toBe(1)
    })

    it('throws when codexSessionId missing', async () => {
        const provider = createCodexForkProvider(() => makeClient())
        await expect(
            provider.spawnFork({
                sourceMetadata: { path: '/w', host: 'h' },
                sourceCwd: '/tmp/x',
            } as any)
        ).rejects.toThrow(/codexSessionId/)
    })

    it('calls client.close() in finally after success', async () => {
        let closed = false
        const client = makeClient()
        ;(client as any).close = async () => { closed = true }
        const provider = createCodexForkProvider(() => client)
        await provider.spawnFork({
            sourceMetadata: { path: '/w', host: 'h', codexSessionId: 's' },
            sourceCwd: '/w',
        } as any)
        expect(closed).toBe(true)
    })

    it('calls client.close() even when forkThread throws', async () => {
        let closed = false
        const client: CodexForkClient = {
            async forkThread() { throw new Error('fork-boom') },
            async resumeThread() { return undefined },
            close: async () => { closed = true }
        }
        const provider = createCodexForkProvider(() => client)
        await expect(provider.spawnFork({
            sourceMetadata: { path: '/w', host: 'h', codexSessionId: 's' },
            sourceCwd: '/w',
        } as any)).rejects.toThrow(/fork-boom/)
        expect(closed).toBe(true)
    })

    it('forkPoint absent → forkThread called with numTurns undefined (HEAD fork)', async () => {
        const forkCalls: Array<{ threadId: string; numTurns?: number }> = []
        const client = makeClient({
            async forkThread(args) {
                forkCalls.push(args)
                return { newThreadId: 'nt' }
            }
        })
        const provider = createCodexForkProvider(() => client)
        await provider.spawnFork({
            sourceMetadata: { path: '/w', host: 'h', codexSessionId: 't1' },
            sourceCwd: '/w'
        } as any)
        expect(forkCalls).toHaveLength(1)
        expect(forkCalls[0].threadId).toBe('t1')
        expect(forkCalls[0].numTurns).toBeUndefined()
    })

    it('forkPoint present → forkThread called with numTurns = tailOffset', async () => {
        const forkCalls: Array<{ threadId: string; numTurns?: number }> = []
        const client = makeClient({
            async forkThread(args) {
                forkCalls.push(args)
                return { newThreadId: 'nt' }
            }
        })
        const provider = createCodexForkProvider(() => client)
        await provider.spawnFork({
            sourceMetadata: { path: '/w', host: 'h', codexSessionId: 't1' },
            sourceCwd: '/w',
            forkPoint: { messageId: 'm-42', tailOffset: 3 }
        } as any)
        expect(forkCalls).toEqual([{ threadId: 't1', numTurns: 3 }])
    })

    it('resumeThread still uses newThreadId even with per-message fork', async () => {
        const resumeCalls: string[] = []
        const client = makeClient({
            async forkThread() {
                return { newThreadId: 'new-nt' }
            },
            async resumeThread({ threadId }) {
                resumeCalls.push(threadId)
                return undefined
            }
        })
        const provider = createCodexForkProvider(() => client)
        const result = await provider.spawnFork({
            sourceMetadata: { path: '/w', host: 'h', codexSessionId: 'src' },
            sourceCwd: '/w',
            forkPoint: { messageId: 'm', tailOffset: 2 }
        } as any)
        expect(resumeCalls).toEqual(['new-nt'])
        expect(result.metadataPatch.codexSessionId).toBe('new-nt')
    })
})
