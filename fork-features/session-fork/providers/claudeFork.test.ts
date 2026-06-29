import { describe, it, expect, beforeEach } from 'bun:test'
import { claudeForkProvider, __setSpawnClaudeForkForTests, __resetSpawnClaudeForkForTests } from './claudeFork'

beforeEach(() => __resetSpawnClaudeForkForTests())

describe('claudeForkProvider', () => {
    it('calls claude with sourceSessionId+cwd+newHapiSessionId and returns new sessionId', async () => {
        const calls: any[] = []
        __setSpawnClaudeForkForTests(async (args) => {
            calls.push(args)
            return { newClaudeSessionId: 'new-claude-sess' }
        })
        const result = await claudeForkProvider.spawnFork({
            sourceMetadata: { path: '/w', host: 'h', claudeSessionId: 'src-sess' },
            sourceCwd: '/tmp/work',
            newHapiSessionId: 'new-hapi'
        } as any)
        expect(calls.length).toBe(1)
        expect(calls[0].sourceSessionId).toBe('src-sess')
        expect(calls[0].cwd).toBe('/tmp/work')
        expect(calls[0].newHapiSessionId).toBe('new-hapi')
        expect(result.providerSessionId).toBe('new-claude-sess')
        expect(result.metadataPatch.claudeSessionId).toBe('new-claude-sess')
    })

    it('passes through sourceModel when provided', async () => {
        const calls: any[] = []
        __setSpawnClaudeForkForTests(async (args) => {
            calls.push(args)
            return { newClaudeSessionId: 'n' }
        })
        await claudeForkProvider.spawnFork({
            sourceMetadata: { path: '/w', host: 'h', claudeSessionId: 'src' },
            sourceCwd: '/w',
            sourceModel: 'claude-opus-4-8',
            newHapiSessionId: 'n'
        } as any)
        expect(calls[0].model).toBe('claude-opus-4-8')
    })

    it('throws if sourceMetadata lacks claudeSessionId', async () => {
        await expect(
            claudeForkProvider.spawnFork({
                sourceMetadata: { path: '/w', host: 'h' },
                sourceCwd: '/tmp/x',
                newHapiSessionId: 'n'
            } as any)
        ).rejects.toThrow(/claudeSessionId/)
    })
})
