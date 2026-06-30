import { describe, it, expect, beforeEach } from 'bun:test'
import { forkSession, HttpError, type ForkDeps, type ForkSourceSession } from './hubForkController'
import { __resetRegistryForTests, registerForkProvider } from './providerRegistry'

interface MakeDepsOpts {
    source?: Partial<ForkSourceSession> | null
    forkShouldThrow?: Error
    spawnResult?: { type: 'success'; sessionId: string } | { type: 'error'; message: string }
    copyShouldThrow?: Error
    updateShouldThrow?: Error
    captured?: any[]
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
        copyMessages(srcId, dstId) {
            captured.push(['copy', srcId, dstId])
            if (opts.copyShouldThrow) throw opts.copyShouldThrow
            return { copied: 3 }
        },
        updateMetadata(sessionId, patch) {
            captured.push(['updateMetadata', sessionId, patch])
            if (opts.updateShouldThrow) throw opts.updateShouldThrow
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
        expect(copyCall).toEqual(['copy', 'src', 'new-hapi-id'])

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

    it('still succeeds when copyMessages throws (degraded — empty transcript)', async () => {
        const captured: any[] = []
        const deps = makeDeps({ captured, copyShouldThrow: new Error('db locked') })
        const res = await forkSession({ srcSessionId: 'src', deps })
        expect(res.newSessionId).toBe('new-hapi-id')
        // updateMetadata still runs
        expect(captured.find(c => c[0] === 'updateMetadata')).toBeTruthy()
    })

    it('still succeeds when updateMetadata throws', async () => {
        const deps = makeDeps({ updateShouldThrow: new Error('write fail') })
        const res = await forkSession({ srcSessionId: 'src', deps })
        expect(res.newSessionId).toBe('new-hapi-id')
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
