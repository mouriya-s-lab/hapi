import { describe, it, expect, beforeEach } from 'bun:test'
import {
    claudeForkProvider,
    __setSpawnClaudeForkForTests,
    __resetSpawnClaudeForkForTests
} from './claudeFork'

beforeEach(() => __resetSpawnClaudeForkForTests())

describe('claudeForkProvider', () => {
    it('calls claude with sourceSessionId+cwd and returns new sessionId', async () => {
        const calls: any[] = []
        __setSpawnClaudeForkForTests(async (args) => {
            calls.push(args)
            return { newClaudeSessionId: 'new-claude-sess' }
        })
        const result = await claudeForkProvider.spawnFork({
            sourceMetadata: { path: '/w', host: 'h', claudeSessionId: 'src-sess' },
            sourceCwd: '/tmp/work'
        } as any)
        expect(calls.length).toBe(1)
        expect(calls[0].sourceSessionId).toBe('src-sess')
        expect(calls[0].cwd).toBe('/tmp/work')
        expect(calls[0].providerMessageId).toBeUndefined()
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
            sourceModel: 'claude-opus-4-8'
        } as any)
        expect(calls[0].model).toBe('claude-opus-4-8')
    })

    it('throws if sourceMetadata lacks claudeSessionId', async () => {
        await expect(
            claudeForkProvider.spawnFork({
                sourceMetadata: { path: '/w', host: 'h' },
                sourceCwd: '/tmp/x'
            } as any)
        ).rejects.toThrow(/claudeSessionId/)
    })

    it('returns deferred Claude launch metadata for per-message fork', async () => {
        const result = await claudeForkProvider.spawnFork({
            sourceMetadata: { path: '/w', host: 'h', claudeSessionId: 'src' },
            sourceCwd: '/tmp/x',
            forkPoint: {
                messageId: 'hapi-m-42',
                tailOffset: 3,
                providerAnchor: { type: 'message-uuid', messageUuid: 'provider-42' },
                isFirstUserTurn: false
            }
        } as any)
        expect(result.providerSessionId).toBeString()
        expect(result.metadataPatch).toEqual({})
        expect(result.claudeLaunch).toEqual({ type: 'resume-at', sourceSessionId: 'src', providerMessageId: 'provider-42' })
    })

    it('returns a fresh deferred launch for the first user turn', async () => {
        const result = await claudeForkProvider.spawnFork({
            sourceMetadata: { path: '/w', host: 'h', claudeSessionId: 'src' },
            sourceCwd: '/w',
            forkPoint: { messageId: 'm-1', tailOffset: 2, isFirstUserTurn: true }
        } as any)
        expect(result.metadataPatch).toEqual({})
        expect(result.claudeLaunch).toEqual({ type: 'fresh' })
    })

    it('rejects non-first per-message fork without providerMessageId', async () => {
        await expect(claudeForkProvider.spawnFork({
            sourceMetadata: { path: '/w', host: 'h', claudeSessionId: 'src' },
            sourceCwd: '/w',
            forkPoint: { messageId: 'm-42', tailOffset: 2, isFirstUserTurn: false }
        } as any)).rejects.toThrow(/providerMessageId/)
    })

    it('accepts payload without forkPoint (HEAD fork, #55 semantics preserved)', async () => {
        const calls: any[] = []
        __setSpawnClaudeForkForTests(async (args) => {
            calls.push(args)
            return { newClaudeSessionId: 'ok' }
        })
        const result = await claudeForkProvider.spawnFork({
            sourceMetadata: { path: '/w', host: 'h', claudeSessionId: 'src' },
            sourceCwd: '/w'
        } as any)
        expect(calls.length).toBe(1)
        expect(result.providerSessionId).toBe('ok')
    })
})
