import { describe, it, expect, beforeEach } from 'bun:test'
import { forkSession, HttpError, type ForkDeps, type ForkMessage, type ForkSourceSession } from './hubForkController'
import { __resetRegistryForTests, registerForkProvider } from './providerRegistry'

interface MakeDepsOpts {
    source?: Partial<ForkSourceSession> | null
    forkShouldThrow?: Error
    forkResult?: { providerSessionId: string; metadataPatch: Record<string, any>; claudeLaunch?: any }
    spawnResult?: { type: 'success'; sessionId: string } | { type: 'error'; message: string }
    copyShouldThrow?: Error
    updateShouldThrow?: Error
    captured?: any[]
    messages?: ForkMessage[]
    resolveProviderMessageIdImpl?: (sessionId: string, targetSeq: number, flavor: string) => any
    registerCreatedSession?: boolean
}

function makeDeps(opts: MakeDepsOpts = {}): ForkDeps {
    const captured = opts.captured ?? []
    const baseSource: ForkSourceSession = {
        id: 'src',
        machineId: 'mac-1',
        metadata: { flavor: 'claude', claudeSessionId: 'csrc', name: 'Hello' },
        cwd: '/work',
        model: 'claude-opus-4-8',
        permissionMode: 'default',
        collaborationMode: 'default',
        ...opts.source
    }
    return {
        getSession() {
            return opts.source === null ? null : baseSource
        },
        async forkProvider(machineId, request) {
            captured.push(['forkProvider', machineId, request])
            if (opts.forkShouldThrow) throw opts.forkShouldThrow
            return opts.forkResult ?? {
                providerSessionId: 'new-prov-id',
                metadataPatch: { claudeSessionId: 'new-prov-id' }
            }
        },
        async spawnSession(args) {
            captured.push(['spawnSession', args])
            return opts.spawnResult ?? { type: 'success', sessionId: 'new-hapi-id' }
        },
        listMessages() {
            return opts.messages ?? []
        },
        copyMessages(srcId, dstId, copyOpts) {
            captured.push(['copy', srcId, dstId, copyOpts])
            if (opts.copyShouldThrow) throw opts.copyShouldThrow
            return { copied: 3 }
        },
        updateMetadata(sessionId, patch) {
            captured.push(['updateMetadata', sessionId, patch])
            if (opts.updateShouldThrow) throw opts.updateShouldThrow
        },
        ...(opts.registerCreatedSession
            ? { registerCreatedSession(sessionId: string) { captured.push(['registerCreatedSession', sessionId]) } }
            : {}),
        resolveProviderMessageId(sessionId, targetSeq, flavor) {
            captured.push(['resolveProviderMessageId', sessionId, targetSeq, flavor])
            return opts.resolveProviderMessageIdImpl
                ? opts.resolveProviderMessageIdImpl(sessionId, targetSeq, flavor)
                : undefined
        }
    }
}

beforeEach(() => {
    __resetRegistryForTests()
    registerForkProvider('claude', {
        async spawnFork() {
            return { providerSessionId: 'x', metadataPatch: {} }
        }
    })
})

describe('forkSession', () => {
    it('happy path: provider fork → spawnSession → copyMessages → updateMetadata', async () => {
        const captured: any[] = []
        const deps = makeDeps({ captured })
        const res = await forkSession({ srcSessionId: 'src', deps })

        expect(res.newSessionId).toBe('new-hapi-id')

        const forkCall = captured.find(c => c[0] === 'forkProvider')!
        expect(forkCall[1]).toBe('mac-1')
        expect(forkCall[2].flavor).toBe('claude')
        expect(forkCall[2].payload.sourceMetadata.claudeSessionId).toBe('csrc')

        const spawnCall = captured.find(c => c[0] === 'spawnSession')!
        expect(spawnCall[1].resumeSessionId).toBe('new-prov-id')
        expect(spawnCall[1].flavor).toBe('claude')
        expect(spawnCall[1].machineId).toBe('mac-1')

        const copyCall = captured.find(c => c[0] === 'copy')!
        expect(copyCall.slice(0, 3)).toEqual(['copy', 'src', 'new-hapi-id'])
        // HEAD fork: no beforeSeq passed
        expect(copyCall[3]).toBeUndefined()

        const updateCall = captured.find(c => c[0] === 'updateMetadata')!
        expect(updateCall[1]).toBe('new-hapi-id')
        expect(updateCall[2].forkedFrom).toBe('src')
        expect(typeof updateCall[2].forkedAt).toBe('number')
        expect(updateCall[2].claudeSessionId).toBe('new-prov-id')
        expect(updateCall[2].name).toMatch(/^f[1-9]: Hello$/)
    })

    it('registers the created session before transcript work exposes it', async () => {
        const captured: any[] = []
        await forkSession({
            srcSessionId: 'src',
            deps: makeDeps({ captured, registerCreatedSession: true })
        })

        expect(captured.map((call) => call[0])).toEqual([
            'forkProvider',
            'spawnSession',
            'registerCreatedSession',
            'copy',
            'updateMetadata'
        ])
    })

    it('returns 404 when source missing', async () => {
        const deps = makeDeps({ source: null })
        await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toMatchObject({
            status: 404
        })
    })

    it('returns 400 when flavor not supported', async () => {
        const deps = makeDeps({ source: { metadata: { flavor: 'cursor' } as any } })
        await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toMatchObject({
            status: 400
        })
    })

    it('returns 400 when flavor missing', async () => {
        const deps = makeDeps({ source: { metadata: {} as any } })
        await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toMatchObject({
            status: 400
        })
    })

    it('returns 502 when provider fork RPC throws', async () => {
        const deps = makeDeps({ forkShouldThrow: new Error('app-server dead') })
        await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toMatchObject({
            status: 502
        })
    })

    it('returns a blocked domain result when the selected Codex turn is still in progress', async () => {
        const deps = makeDeps({
            forkShouldThrow: new Error("lastTurnId 'turn-1' identifies an in-progress turn")
        })
        await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toMatchObject({
            name: 'ForkBlockedError',
            message: 'The selected message is still being processed. Wait for the turn to finish, then try again.'
        })
    })

    it('returns 500 when spawnSession returns error', async () => {
        const deps = makeDeps({ spawnResult: { type: 'error', message: 'no machine' } })
        await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toMatchObject({
            status: 500
        })
    })

    it('does not report success when transcript copy fails', async () => {
        const captured: any[] = []
        const deps = makeDeps({ captured, copyShouldThrow: new Error('db locked') })
        await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toThrow('db locked')
        expect(captured.find(c => c[0] === 'updateMetadata')).toBeUndefined()
    })

    it('does not report success when lineage metadata write fails', async () => {
        const deps = makeDeps({ updateShouldThrow: new Error('write fail') })
        await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toThrow('write fail')
    })

    it('inherits the generated summary when the source has no explicit name', async () => {
        const captured: any[] = []
        const deps = makeDeps({
            captured,
            source: {
                metadata: {
                    flavor: 'claude',
                    claudeSessionId: 'c',
                    summary: { text: 'Generated title', updatedAt: 1 }
                } as any
            }
        })
        await forkSession({ srcSessionId: 'src', deps })
        const updateCall = captured.find(c => c[0] === 'updateMetadata')!
        expect(updateCall[2].name).toMatch(/^f[1-9]: Generated title$/)
    })

    it('uses Untitled only when the source has neither a name nor a summary', async () => {
        const captured: any[] = []
        const deps = makeDeps({
            captured,
            source: { metadata: { flavor: 'claude', claudeSessionId: 'c' } as any }
        })
        await forkSession({ srcSessionId: 'src', deps })
        const updateCall = captured.find(c => c[0] === 'updateMetadata')!
        expect(updateCall[2].name).toMatch(/^f[1-9]: Untitled$/)
    })

    it('inherits an existing fork title instead of replacing it', async () => {
        const captured: any[] = []
        const deps = makeDeps({
            captured,
            source: { metadata: { flavor: 'claude', claudeSessionId: 'c', name: 'f4: Hello' } as any }
        })
        await forkSession({ srcSessionId: 'src', deps })
        const updateCall = captured.find(c => c[0] === 'updateMetadata')!
        expect(updateCall[2].name).toMatch(/^f[1-9]: f4: Hello$/)
    })

    it('preserves source worktree metadata so the fork stays grouped under the base repository', async () => {
        const captured: any[] = []
        const worktree = {
            basePath: '/code/coder-loop',
            branch: 'hapi-0718-c680',
            name: '0718-c680',
            worktreePath: '/code/coder-loop-worktrees/0718-c680',
            createdAt: 123
        }
        const deps = makeDeps({
            captured,
            source: {
                cwd: worktree.worktreePath,
                metadata: {
                    flavor: 'claude',
                    claudeSessionId: 'csrc',
                    worktree
                }
            }
        })

        await forkSession({ srcSessionId: 'src', deps })

        const spawnCall = captured.find(c => c[0] === 'spawnSession')!
        expect(spawnCall[1].cwd).toBe(worktree.worktreePath)
        const updateCall = captured.find(c => c[0] === 'updateMetadata')!
        expect(updateCall[2].worktree).toEqual(worktree)
    })

    it('rejects with HttpError instances', async () => {
        const deps = makeDeps({ source: null })
        try {
            await forkSession({ srcSessionId: 'src', deps })
            throw new Error('expected throw')
        } catch (err) {
            expect(err).toBeInstanceOf(HttpError)
        }
    })
})

describe('forkSession per-message (#61 c4)', () => {
    const CODEX_MSGS: ForkMessage[] = [
        { id: 'm1', seq: 1, role: 'user' },
        { id: 'm2', seq: 2, role: 'agent' },
        { id: 'm3', seq: 3, role: 'user' },
        { id: 'm4', seq: 4, role: 'agent' },
        { id: 'm5', seq: 5, role: 'user' },
        { id: 'm6', seq: 6, role: 'agent' }
    ]

    function codexDeps(overrides: Partial<MakeDepsOpts> = {}): ForkDeps {
        return makeDeps({
            source: {
                metadata: { flavor: 'codex', codexSessionId: 'cx-src' } as any
            },
            messages: CODEX_MSGS,
            ...overrides
        })
    }

    it('happy per-message (codex): computes tailOffset + passes forkPoint to provider + copies STRICTLY BEFORE targetSeq + writes forkedFromMessageId', async () => {
        const captured: any[] = []
        const deps = codexDeps({ captured })
        await forkSession({
            srcSessionId: 'src',
            deps,
            forkPoint: { messageId: 'm3' }
        })

        const forkCall = captured.find((c) => c[0] === 'forkProvider')!
        // Codex uses tailOffset alone (count-based); no providerMessageId.
        expect(forkCall[2].payload.forkPoint).toEqual({ messageId: 'm3', tailOffset: 1, isFirstUserTurn: false })

        const copyCall = captured.find((c) => c[0] === 'copy')!
        // beforeSeq semantics: target user message (seq=3) is NOT copied.
        expect(copyCall[3]).toEqual({ beforeSeq: 3 })

        const updateCall = captured.find((c) => c[0] === 'updateMetadata')!
        expect(updateCall[2].forkedFromMessageId).toBe('m3')
        expect(updateCall[2].forkedFrom).toBe('src')
    })

    it('tailOffset counts only user turns strictly after target', async () => {
        const captured: any[] = []
        const deps = codexDeps({ captured })
        await forkSession({ srcSessionId: 'src', deps, forkPoint: { messageId: 'm1' } })
        const forkCall = captured.find((c) => c[0] === 'forkProvider')!
        expect(forkCall[2].payload.forkPoint.tailOffset).toBe(2) // m3, m5
    })

    it('tailOffset = 0 when target is the last user message', async () => {
        const captured: any[] = []
        const deps = codexDeps({ captured })
        await forkSession({ srcSessionId: 'src', deps, forkPoint: { messageId: 'm5' } })
        const forkCall = captured.find((c) => c[0] === 'forkProvider')!
        expect(forkCall[2].payload.forkPoint.tailOffset).toBe(0)
    })

    it('OMP tailOffset ignores native session commands that do not create branch entries', async () => {
        const captured: any[] = []
        const deps = makeDeps({
            captured,
            source: {
                metadata: {
                    flavor: 'omp',
                    ompSession: { id: 'omp-src', file: '/sessions/omp-src.jsonl' }
                } as any
            },
            messages: [
                { id: 'm1', seq: 1, role: 'user', text: 'first prompt' },
                { id: 'm2', seq: 2, role: 'agent' },
                { id: 'm3', seq: 3, role: 'user', text: '/rename New title' },
                { id: 'm4', seq: 4, role: 'user', text: 'second prompt' }
            ]
        })

        await forkSession({ srcSessionId: 'src', deps, forkPoint: { messageId: 'm1' } })

        const forkCall = captured.find((c) => c[0] === 'forkProvider')!
        expect(forkCall[2].payload.forkPoint.tailOffset).toBe(1)
        expect(forkCall[2].payload.forkPoint.targetText).toBe('first prompt')
        expect(forkCall[2].payload.forkPoint.matchingTextTailOffset).toBe(0)
    })

    it('rejects an OMP session command as a non-native branch target', async () => {
        const deps = makeDeps({
            source: {
                metadata: {
                    flavor: 'omp',
                    ompSession: { id: 'omp-src', file: '/sessions/omp-src.jsonl' }
                } as any
            },
            messages: [{ id: 'rename', seq: 1, role: 'user', text: '/rename New title' }]
        })

        await expect(
            forkSession({ srcSessionId: 'src', deps, forkPoint: { messageId: 'rename' } })
        ).rejects.toMatchObject({ status: 400 })
    })

    it('rejects OMP rewind across a native session boundary before provider RPC', async () => {
        const captured: any[] = []
        const deps = makeDeps({
            captured,
            source: {
                metadata: {
                    flavor: 'omp',
                    ompSession: { id: 'omp-new', file: '/sessions/omp-new.jsonl' }
                } as any
            },
            messages: [
                { id: 'old', seq: 1, role: 'user', text: 'old native prompt' },
                { id: 'clear', seq: 2, role: 'user', text: '/clear' },
                { id: 'new', seq: 3, role: 'user', text: 'new native prompt' }
            ]
        })

        await expect(
            forkSession({ srcSessionId: 'src', deps, forkPoint: { messageId: 'old' } })
        ).rejects.toMatchObject({ status: 400 })
        expect(captured.some((call) => call[0] === 'forkProvider')).toBe(false)
    })

    it('rejects 400 when forkPoint.messageId does not belong to source session', async () => {
        const deps = codexDeps()
        await expect(
            forkSession({ srcSessionId: 'src', deps, forkPoint: { messageId: 'not-real' } })
        ).rejects.toMatchObject({ status: 400 })
    })

    it('rejects 400 when forkPoint is an assistant message (role !== user)', async () => {
        const deps = codexDeps()
        await expect(
            forkSession({ srcSessionId: 'src', deps, forkPoint: { messageId: 'm2' } })
        ).rejects.toMatchObject({ status: 400 })
    })

    it('claude + forkPoint: accepts, resolves providerMessageId, passes it in payload', async () => {
        const captured: any[] = []
        const deps = makeDeps({
            captured,
            source: {
                metadata: { flavor: 'claude', claudeSessionId: 'csrc' } as any
            },
            messages: [
                { id: 'm1', seq: 1, role: 'user' },
                { id: 'm2', seq: 2, role: 'agent' },
                { id: 'm3', seq: 3, role: 'user' }
            ],
            resolveProviderMessageIdImpl: (_sid, _seq, flavor) =>
                flavor === 'claude'
                    ? { type: 'message-uuid', messageUuid: 'asst-uuid-from-m2' }
                    : undefined
        })
        await forkSession({
            srcSessionId: 'src',
            deps,
            forkPoint: { messageId: 'm3' }
        })

        const resolveCall = captured.find((c) => c[0] === 'resolveProviderMessageId')!
        expect(resolveCall.slice(1)).toEqual(['src', 3, 'claude'])

        const forkCall = captured.find((c) => c[0] === 'forkProvider')!
        // Claude uses BOTH tailOffset (unused by provider but preserved for
        // schema compat) and providerMessageId (the actual anchor).
        expect(forkCall[2].payload.forkPoint).toEqual({
            messageId: 'm3',
            tailOffset: 0,
            isFirstUserTurn: false,
            providerAnchor: { type: 'message-uuid', messageUuid: 'asst-uuid-from-m2' }
        })

        // Hub-DB copy is STRICTLY before target: seq=3 excluded.
        const copyCall = captured.find((c) => c[0] === 'copy')!
        expect(copyCall[3]).toEqual({ beforeSeq: 3 })
    })

    it('rewinds the first Claude user turn as a fresh empty session', async () => {
        const captured: any[] = []
        const deps = makeDeps({
            captured,
            source: {
                metadata: { flavor: 'claude', claudeSessionId: 'csrc' } as any
            },
            messages: [{ id: 'm1', seq: 1, role: 'user' }],
            forkResult: {
                providerSessionId: 'new-prov-id',
                metadataPatch: {},
                claudeLaunch: { type: 'fresh' }
            },
            resolveProviderMessageIdImpl: () => undefined
        })
        const result = await forkSession({
            srcSessionId: 'src',
            deps,
            forkPoint: { messageId: 'm1' }
        })
        expect(result.newSessionId).toBe('new-hapi-id')
        const forkCall = captured.find((c) => c[0] === 'forkProvider')!
        expect(forkCall[2].payload.forkPoint).toEqual({
            messageId: 'm1',
            tailOffset: 0,
            isFirstUserTurn: true
        })
        expect(captured.find((c) => c[0] === 'copy')![3]).toEqual({ beforeSeq: 1 })
        expect(captured.find((c) => c[0] === 'updateMetadata')![2]).toMatchObject({
            pendingClaudeLaunch: {
                resumeSessionId: 'new-prov-id',
                launch: { type: 'fresh' }
            }
        })
    })

    it('rejects a non-first Claude turn whose legacy transcript lacks a provider anchor', async () => {
        const captured: any[] = []
        const deps = makeDeps({
            captured,
            source: { metadata: { flavor: 'claude', claudeSessionId: 'csrc' } as any },
            messages: [
                { id: 'm1', seq: 1, role: 'user' },
                { id: 'm2', seq: 2, role: 'agent' },
                { id: 'm3', seq: 3, role: 'user' }
            ],
            resolveProviderMessageIdImpl: () => undefined
        })
        await expect(forkSession({
            srcSessionId: 'src',
            deps,
            forkPoint: { messageId: 'm3' }
        })).rejects.toMatchObject({ status: 400 })
        expect(captured.some((c) => c[0] === 'forkProvider')).toBe(false)
    })

    it('rejects 400 without touching DB (no forkProvider / spawnSession / copyMessages / updateMetadata calls)', async () => {
        const captured: any[] = []
        const deps = codexDeps({ captured })
        await expect(
            forkSession({ srcSessionId: 'src', deps, forkPoint: { messageId: 'not-real' } })
        ).rejects.toMatchObject({ status: 400 })
        expect(captured.find((c) => c[0] === 'forkProvider')).toBeUndefined()
        expect(captured.find((c) => c[0] === 'spawnSession')).toBeUndefined()
        expect(captured.find((c) => c[0] === 'copy')).toBeUndefined()
        expect(captured.find((c) => c[0] === 'updateMetadata')).toBeUndefined()
    })

    it('backward-compat: HEAD fork (no forkPoint) does not write forkedFromMessageId and does not pass forkPoint to provider or copy', async () => {
        const captured: any[] = []
        const deps = codexDeps({ captured })
        await forkSession({ srcSessionId: 'src', deps })

        const forkCall = captured.find((c) => c[0] === 'forkProvider')!
        expect(forkCall[2].payload.forkPoint).toBeUndefined()

        const copyCall = captured.find((c) => c[0] === 'copy')!
        expect(copyCall[3]).toBeUndefined()

        const updateCall = captured.find((c) => c[0] === 'updateMetadata')!
        expect(updateCall[2].forkedFromMessageId).toBeUndefined()
    })
})
