import { describe, it, expect, beforeEach } from 'bun:test'
import { forkSession, HttpError, type ForkDeps, type ForkMessage, type ForkSourceSession } from './hubForkController'
import { __resetRegistryForTests, registerForkProvider } from './providerRegistry'

interface MakeDepsOpts {
    source?: Partial<ForkSourceSession> | null
    forkShouldThrow?: Error
    spawnResult?: { type: 'success'; sessionId: string } | { type: 'error'; message: string }
    copyShouldThrow?: Error
    updateShouldThrow?: Error
    captured?: any[]
    messages?: ForkMessage[]
    resolveProviderMessageIdImpl?: (sessionId: string, targetSeq: number, flavor: string) => string | undefined
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
            return {
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
        expect(updateCall[2].name).toBe('Hello (fork)')
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

    it('uses "Untitled" suffix when source name missing', async () => {
        const captured: any[] = []
        const deps = makeDeps({
            captured,
            source: { metadata: { flavor: 'claude', claudeSessionId: 'c' } as any }
        })
        await forkSession({ srcSessionId: 'src', deps })
        const updateCall = captured.find(c => c[0] === 'updateMetadata')!
        expect(updateCall[2].name).toBe('Untitled (fork)')
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
        expect(forkCall[2].payload.forkPoint).toEqual({ messageId: 'm3', tailOffset: 1 })

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
                flavor === 'claude' ? 'asst-uuid-from-m2' : undefined
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
            providerMessageId: 'asst-uuid-from-m2'
        })

        // Hub-DB copy is STRICTLY before target: seq=3 excluded.
        const copyCall = captured.find((c) => c[0] === 'copy')!
        expect(copyCall[3]).toEqual({ beforeSeq: 3 })
    })

    it('rejects Claude rewind without a provider anchor before creating a fork', async () => {
        const captured: any[] = []
        const deps = makeDeps({
            captured,
            source: {
                metadata: { flavor: 'claude', claudeSessionId: 'csrc' } as any
            },
            messages: [{ id: 'm1', seq: 1, role: 'user' }],
            resolveProviderMessageIdImpl: () => undefined
        })
        await expect(forkSession({
            srcSessionId: 'src',
            deps,
            forkPoint: { messageId: 'm1' }
        })).rejects.toMatchObject({ status: 400 })
        expect(captured.some((c) => c[0] === 'forkProvider')).toBe(false)
        expect(captured.some((c) => c[0] === 'spawnSession')).toBe(false)
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
