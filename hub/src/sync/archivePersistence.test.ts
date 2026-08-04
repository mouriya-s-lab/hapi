import { describe, expect, it } from 'bun:test'
import { toSessionSummary } from '@hapi/protocol'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'

// Integration coverage for issue #4 Feature A: explicit archive must persist an
// `archivedAt` marker (distinct from natural session end / timeout) so the web
// can hide user-archived sessions. Uses a real in-memory SQLite Store so the
// full archiveSession → updateSessionMetadata → SQLite → reload path is exercised.

function createEngine(store: Store): SyncEngine {
    const engine = new SyncEngine(
        store,
        {} as never,
        new RpcRegistry(),
        { broadcast() {} } as never
    )
    // archiveSession calls rpcGateway.killSession; the gateway is stubbed in
    // this harness, so provide a no-op.
    ;(engine as any).rpcGateway.killSession = async () => {}
    engine.stop()
    return engine
}

function newSession(engine: SyncEngine, tag: string) {
    return engine.getOrCreateSession(
        tag,
        { path: '/tmp/project', host: 'localhost', flavor: 'claude' },
        { requests: {}, completedRequests: {} },
        'default'
    )
}

describe('archive persistence', () => {
    it('marks an explicitly-archived session with archivedAt and persists it across restart', async () => {
        const store = new Store(':memory:')
        const engine = createEngine(store)

        const session = newSession(engine, 'archive-me')
        await engine.archiveSession(session.id)

        const after = engine.getSession(session.id)
        expect(after?.active).toBe(false)
        expect(after?.metadata?.archivedAt).toBeGreaterThan(0)

        // Persisted to SQLite → survives a hub restart (fresh engine, same store).
        const reloaded = createEngine(store).getSession(session.id)
        expect(reloaded?.metadata?.archivedAt).toBeGreaterThan(0)

        // And it is surfaced on the session summary the web consumes.
        expect(toSessionSummary(reloaded!).metadata?.archivedAt).toBeGreaterThan(0)
    })

    it('does NOT mark naturally-ended sessions as archived', () => {
        const store = new Store(':memory:')
        const engine = createEngine(store)

        const session = newSession(engine, 'end-me')
        engine.handleSessionEnd({ sid: session.id, time: Date.now() })

        const after = engine.getSession(session.id)
        expect(after?.active).toBe(false)
        expect(after?.metadata?.archivedAt).toBeUndefined()
        expect(toSessionSummary(after!).metadata?.archivedAt).toBeUndefined()
    })

    it('does NOT mark timed-out (expireInactive) sessions as archived', () => {
        const store = new Store(':memory:')
        const engine = createEngine(store)

        const session = newSession(engine, 'expire-me')
        // Make it active, then force expiry by moving activeAt into the past.
        engine.handleSessionAlive({ sid: session.id, time: Date.now() })
        const cached = engine.getSession(session.id)!
        cached.activeAt = Date.now() - 60_000
        ;(engine as any).sessionCache.expireInactive(Date.now())

        const after = engine.getSession(session.id)
        expect(after?.active).toBe(false)
        expect(after?.metadata?.archivedAt).toBeUndefined()
    })
})
