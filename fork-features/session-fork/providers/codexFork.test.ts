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
            newHapiSessionId: 'new-hapi'
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
            newHapiSessionId: 'n'
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
            newHapiSessionId: 'n'
        } as any)
        expect(factoryCalled).toBe(1)
    })

    it('throws when codexSessionId missing', async () => {
        const provider = createCodexForkProvider(() => makeClient())
        await expect(
            provider.spawnFork({
                sourceMetadata: { path: '/w', host: 'h' },
                sourceCwd: '/tmp/x',
                newHapiSessionId: 'n'
            } as any)
        ).rejects.toThrow(/codexSessionId/)
    })
})
