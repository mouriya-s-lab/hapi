import { describe, it, expect, beforeEach } from 'bun:test'
import { forkSession, HttpError, type ForkDeps, type ForkSourceSession } from './hubForkController'
import { __resetRegistryForTests, registerForkProvider } from './providerRegistry'

function makeDeps(overrides: Partial<{
    source: Partial<ForkSourceSession> | null
    activeTurn: boolean
    rpcShouldThrow: Error | null
    txShouldThrow: Error | null
    captured: any[]
}> = {}): ForkDeps {
    const captured = overrides.captured ?? []
    const baseSource: ForkSourceSession = {
        id: 'src',
        machineId: 'mac-1',
        metadata: { flavor: 'claude', claudeSessionId: 'csrc', title: 'Hello' },
        cwd: '/work',
        model: 'claude-opus-4-8',
        permissionMode: 'default',
        collaborationMode: 'default',
        ...overrides.source
    }
    return {
        getSession() {
            return overrides.source === null ? null : baseSource
        },
        hasActiveTurn() {
            return overrides.activeTurn ?? false
        },
        generateSessionId() {
            return 'new-hapi'
        },
        async machineRpc(machineId, method, payload) {
            captured.push(['rpc', machineId, method, payload])
            if (overrides.rpcShouldThrow) throw overrides.rpcShouldThrow
            return {
                providerSessionId: 'new-claude-id',
                metadataPatch: { claudeSessionId: 'new-claude-id' }
            }
        },
        insertSession(row) {
            captured.push(['insert', row])
        },
        copyMessages(src, dst) {
            captured.push(['copy', src, dst])
            if (overrides.txShouldThrow) throw overrides.txShouldThrow
            return { copied: 3 }
        },
        async killLauncher(machineId, providerSessionId) {
            captured.push(['kill', machineId, providerSessionId])
        },
        async tx(fn) {
            return fn() as any
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
    it('happy path: validates, rpcs, inserts session, clones messages', async () => {
        const captured: any[] = []
        const deps = makeDeps({ captured })
        const res = await forkSession({ srcSessionId: 'src', deps })

        expect(res.newSessionId).toBe('new-hapi')

        const insert = captured.find(c => c[0] === 'insert')!
        expect(insert[1].id).toBe('new-hapi')
        expect(insert[1].metadata.forkedFrom).toBe('src')
        expect(typeof insert[1].metadata.forkedAt).toBe('number')
        expect(insert[1].metadata.claudeSessionId).toBe('new-claude-id')
        expect(insert[1].metadata.title).toBe('Hello (fork)')

        const copy = captured.find(c => c[0] === 'copy')!
        expect(copy).toEqual(['copy', 'src', 'new-hapi'])
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

    it('returns 400 when flavor missing entirely', async () => {
        const deps = makeDeps({ source: { metadata: {} as any } })
        await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toMatchObject({
            status: 400
        })
    })

    it('returns 409 when source has active turn', async () => {
        const deps = makeDeps({ activeTurn: true })
        await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toMatchObject({
            status: 409
        })
    })

    it('returns 502 when provider rpc fails', async () => {
        const deps = makeDeps({ rpcShouldThrow: new Error('app-server dead') })
        await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toMatchObject({
            status: 502,
            message: expect.stringMatching(/app-server dead/)
        } as any)
    })

    it('returns 500 + best-effort killLauncher when DB clone fails', async () => {
        const captured: any[] = []
        const deps = makeDeps({ captured, txShouldThrow: new Error('disk full') })
        await expect(forkSession({ srcSessionId: 'src', deps })).rejects.toMatchObject({
            status: 500
        })
        const kill = captured.find(c => c[0] === 'kill')
        expect(kill).toBeTruthy()
        expect(kill[2]).toBe('new-claude-id')
    })

    it('uses "Untitled" suffix when source title missing', async () => {
        const captured: any[] = []
        const deps = makeDeps({
            captured,
            source: { metadata: { flavor: 'claude', claudeSessionId: 'c' } as any }
        })
        await forkSession({ srcSessionId: 'src', deps })
        const insert = captured.find(c => c[0] === 'insert')!
        expect(insert[1].metadata.title).toBe('Untitled (fork)')
    })

    it('rejects with HttpError instances', async () => {
        const deps = makeDeps({ source: null })
        try {
            await forkSession({ srcSessionId: 'src', deps })
        } catch (err) {
            expect(err).toBeInstanceOf(HttpError)
            return
        }
        throw new Error('expected to throw')
    })
})
