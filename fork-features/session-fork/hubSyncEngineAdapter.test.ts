import { describe, it, expect } from 'bun:test'
import { buildForkDeps } from './hubSyncEngineAdapter'

function fakeStore() {
    const messageCopies: any[] = []
    const metadataUpdates: any[] = []
    return {
        store: {
            sessions: {
                getSession: (id: string) =>
                    id === 'src'
                        ? {
                              id: 'src',
                              machineId: 'mac-1',
                              metadata: { flavor: 'claude', path: '/work', title: 'T' },
                              model: 'claude-opus-4-8',
                              permissionMode: 'default',
                              collaborationMode: 'default',
                              metadataVersion: 3
                          }
                        : id === 'dst'
                          ? { id: 'dst', metadataVersion: 1, metadata: {} }
                          : null,
                updateSessionMetadata: (id: string, patch: any, ver: number, ns: string) => {
                    metadataUpdates.push({ id, patch, ver, ns })
                    return { result: 'success' }
                }
            },
            messages: {
                getAllMessages: (_id: string) => [
                    { id: 'a', seq: 1, content: { role: 'user', hello: 1 }, createdAt: 100, invokedAt: 110, scheduledAt: null },
                    { id: 'b', seq: 2, content: { role: 'agent', hello: 2 }, createdAt: 200, invokedAt: 220, scheduledAt: null },
                    { id: 'c', seq: 3, content: { role: 'user', hello: 3 }, createdAt: 300, invokedAt: 330, scheduledAt: null },
                    { id: 'd', seq: 4, content: { role: 'agent', hello: 4 }, createdAt: 400, invokedAt: 440, scheduledAt: null }
                ],
                copyMessageToSession: (dstId: string, payload: any) => {
                    messageCopies.push({ dstId, payload })
                    return { id: 'mid' }
                }
            }
        },
        captures: { messageCopies, metadataUpdates }
    }
}

describe('buildForkDeps', () => {
    it('getSession maps StoredSession to ForkSourceSession', () => {
        const { store } = fakeStore()
        const deps = buildForkDeps({ store, syncEngine: {} as any, namespace: 'default' })
        const src = deps.getSession('src')
        expect(src?.machineId).toBe('mac-1')
        expect(src?.cwd).toBe('/work')
        expect(src?.metadata.flavor).toBe('claude')
        expect(src?.model).toBe('claude-opus-4-8')
    })

    it('getSession returns null for missing', () => {
        const { store } = fakeStore()
        const deps = buildForkDeps({ store, syncEngine: {} as any, namespace: 'default' })
        expect(deps.getSession('missing')).toBeNull()
    })

    it('getSession falls back to metadata.machineId when row.machineId is empty', () => {
        // Mirrors prod: hub's sessions.machine_id column is often null on rows
        // created via paths that only stash machineId inside metadata. The
        // fork RPC routes by machineId, so empty machineId breaks dispatch
        // ("RPC handler not registered: :fork-spawn-session"). Test pins the
        // metadata fallback that prevents that.
        const store = {
            sessions: {
                getSession: () => ({
                    id: 'src',
                    machineId: null,
                    metadata: { flavor: 'claude', path: '/work', machineId: 'mac-via-meta' },
                    metadataVersion: 0
                })
            }
        }
        const deps = buildForkDeps({ store: store as any, syncEngine: {} as any, namespace: 'default' })
        expect(deps.getSession('src')?.machineId).toBe('mac-via-meta')
    })

    it('forkProvider unwraps RPC response into ForkSpawnResultLike', async () => {
        const { store } = fakeStore()
        const syncEngine = {
            async forkProviderSession() {
                return {
                    providerSessionId: 'new-prov',
                    metadataPatch: { claudeSessionId: 'new-prov' }
                }
            }
        }
        const deps = buildForkDeps({ store, syncEngine: syncEngine as any, namespace: 'default' })
        const res = await deps.forkProvider('mac-1', { flavor: 'claude', payload: {} })
        expect(res.providerSessionId).toBe('new-prov')
        expect(res.metadataPatch.claudeSessionId).toBe('new-prov')
    })

    it('forkProvider throws on missing providerSessionId', async () => {
        const { store } = fakeStore()
        const syncEngine = {
            async forkProviderSession() {
                return { metadataPatch: {} }
            }
        }
        const deps = buildForkDeps({ store, syncEngine: syncEngine as any, namespace: 'default' })
        await expect(deps.forkProvider('mac-1', { flavor: 'x', payload: {} })).rejects.toThrow(/providerSessionId/)
    })

    it('spawnSession positional args to SyncEngine.spawnSession', async () => {
        const { store } = fakeStore()
        const calls: any[] = []
        const syncEngine = {
            async spawnSession(...args: any[]) {
                calls.push(args)
                return { type: 'success', sessionId: 'new-hapi' }
            }
        }
        const deps = buildForkDeps({ store, syncEngine: syncEngine as any, namespace: 'default' })
        const res = await deps.spawnSession({
            machineId: 'mac-1',
            cwd: '/w',
            flavor: 'claude',
            model: 'claude-opus-4-8',
            permissionMode: 'default',
            resumeSessionId: 'rs-id'
        })
        expect(res).toEqual({ type: 'success', sessionId: 'new-hapi' })
        expect(calls[0][0]).toBe('mac-1')
        expect(calls[0][1]).toBe('/w')
        expect(calls[0][2]).toBe('claude')
        expect(calls[0][3]).toBe('claude-opus-4-8')
        expect(calls[0][8]).toBe('rs-id') // resumeSessionId position
        expect(calls[0][10]).toBe('default') // permissionMode position
    })

    it('copyMessages iterates getAllMessages → copyMessageToSession', () => {
        const fake = fakeStore()
        const deps = buildForkDeps({ store: fake.store, syncEngine: {} as any, namespace: 'default' })
        const res = deps.copyMessages('src', 'dst')
        expect(res.copied).toBe(4)
        expect(fake.captures.messageCopies.length).toBe(4)
        expect(fake.captures.messageCopies[0].dstId).toBe('dst')
        expect(fake.captures.messageCopies[0].payload.content).toEqual({ role: 'user', hello: 1 })
    })

    it('copyMessages with beforeSeq restricts to messages seq < beforeSeq (STRICT — target excluded)', () => {
        const fake = fakeStore()
        const deps = buildForkDeps({ store: fake.store, syncEngine: {} as any, namespace: 'default' })
        const res = deps.copyMessages('src', 'dst', { beforeSeq: 3 })
        // seq 1 and 2 copied; seq 3 (the target) excluded.
        expect(res.copied).toBe(2)
        expect(fake.captures.messageCopies.map((c) => c.payload.content.hello)).toEqual([1, 2])
    })

    it('copyMessages with beforeSeq=1 copies nothing (rewind to first turn)', () => {
        const fake = fakeStore()
        const deps = buildForkDeps({ store: fake.store, syncEngine: {} as any, namespace: 'default' })
        const res = deps.copyMessages('src', 'dst', { beforeSeq: 1 })
        expect(res.copied).toBe(0)
        expect(fake.captures.messageCopies).toEqual([])
    })

    it('resolveProviderMessageId (claude) returns last assistant uuid strictly before targetSeq', () => {
        const store = {
            sessions: { getSession: () => null },
            messages: {
                getAllMessages: () => [
                    { id: 'h1', seq: 1, content: { role: 'user', content: { type: 'text', text: 'hi' } } },
                    { id: 'h2', seq: 2, content: { role: 'agent', content: { type: 'event', data: { type: 'ready' } } } },
                    {
                        id: 'h3',
                        seq: 3,
                        content: {
                            role: 'agent',
                            content: {
                                type: 'output',
                                data: { type: 'assistant', uuid: 'asst-uuid-a', sessionId: 'src' }
                            }
                        }
                    },
                    {
                        id: 'h4',
                        seq: 4,
                        content: {
                            role: 'agent',
                            content: {
                                type: 'output',
                                data: { type: 'assistant', uuid: 'asst-uuid-b', sessionId: 'src' }
                            }
                        }
                    },
                    { id: 'h5', seq: 5, content: { role: 'user', content: { type: 'text', text: 'rewind here' } } },
                    {
                        id: 'h6',
                        seq: 6,
                        content: {
                            role: 'agent',
                            content: {
                                type: 'output',
                                data: { type: 'assistant', uuid: 'asst-uuid-after', sessionId: 'src' }
                            }
                        }
                    }
                ]
            }
        }
        const deps = buildForkDeps({ store: store as any, syncEngine: {} as any, namespace: 'default' })
        // Target user message is at seq=5. Last assistant before it = seq=4 (asst-uuid-b).
        expect(deps.resolveProviderMessageId('src', 5, 'claude')).toBe('asst-uuid-b')
    })

    it('resolveProviderMessageId returns undefined when target is the first user turn', () => {
        const store = {
            sessions: { getSession: () => null },
            messages: {
                getAllMessages: () => [
                    { id: 'h1', seq: 1, content: { role: 'user', content: { type: 'text', text: 'first ever' } } }
                ]
            }
        }
        const deps = buildForkDeps({ store: store as any, syncEngine: {} as any, namespace: 'default' })
        expect(deps.resolveProviderMessageId('src', 1, 'claude')).toBeUndefined()
    })

    it('resolveProviderMessageId returns undefined for non-claude flavors', () => {
        const store = {
            sessions: { getSession: () => null },
            messages: {
                getAllMessages: () => [
                    {
                        id: 'h1',
                        seq: 1,
                        content: {
                            role: 'agent',
                            content: {
                                type: 'output',
                                data: { type: 'assistant', uuid: 'asst-x' }
                            }
                        }
                    }
                ]
            }
        }
        const deps = buildForkDeps({ store: store as any, syncEngine: {} as any, namespace: 'default' })
        expect(deps.resolveProviderMessageId('src', 5, 'codex')).toBeUndefined()
        expect(deps.resolveProviderMessageId('src', 5, 'omp')).toBeUndefined()
        expect(deps.resolveProviderMessageId('src', 5, 'opencode')).toBeUndefined()
    })

    it('resolveProviderMessageId (claude) skips non-assistant agent lines (ready events, tool_result carriers)', () => {
        const store = {
            sessions: { getSession: () => null },
            messages: {
                getAllMessages: () => [
                    {
                        id: 'h1',
                        seq: 1,
                        content: {
                            role: 'agent',
                            content: { id: 'evt-1', type: 'event', data: { type: 'ready' } }
                        }
                    },
                    {
                        id: 'h2',
                        seq: 2,
                        content: {
                            role: 'agent',
                            content: {
                                type: 'output',
                                data: { type: 'user', uuid: 'nope-uuid' }
                            }
                        }
                    },
                    { id: 'h3', seq: 3, content: { role: 'user', content: { type: 'text' } } }
                ]
            }
        }
        const deps = buildForkDeps({ store: store as any, syncEngine: {} as any, namespace: 'default' })
        expect(deps.resolveProviderMessageId('src', 3, 'claude')).toBeUndefined()
    })

    it('listMessages returns id/seq/role tuples ordered by seq', () => {
        const fake = fakeStore()
        const deps = buildForkDeps({ store: fake.store, syncEngine: {} as any, namespace: 'default' })
        const msgs = deps.listMessages('src')
        expect(msgs).toEqual([
            { id: 'a', seq: 1, role: 'user' },
            { id: 'b', seq: 2, role: 'agent' },
            { id: 'c', seq: 3, role: 'user' },
            { id: 'd', seq: 4, role: 'agent' }
        ])
    })

    it('listMessages returns role=unknown when content lacks role field', () => {
        const store = {
            sessions: { getSession: () => null },
            messages: {
                getAllMessages: () => [
                    { id: 'x', seq: 1, content: null },
                    { id: 'y', seq: 2, content: { type: 'raw' } },
                    { id: 'z', seq: 3, content: { role: 42 } as any }
                ],
                copyMessageToSession: () => ({ id: 'ok' })
            }
        }
        const deps = buildForkDeps({ store: store as any, syncEngine: {} as any, namespace: 'default' })
        expect(deps.listMessages('any').every((m) => m.role === 'unknown')).toBe(true)
    })

    it('updateMetadata passes current metadataVersion + namespace', () => {
        const fake = fakeStore()
        const deps = buildForkDeps({ store: fake.store, syncEngine: {} as any, namespace: 'ns-x' })
        deps.updateMetadata('src', { forkedFrom: 'parent' })
        expect(fake.captures.metadataUpdates).toEqual([
            { id: 'src', patch: { forkedFrom: 'parent' }, ver: 3, ns: 'ns-x' }
        ])
    })

    it('updateMetadata is no-op when session missing', () => {
        const fake = fakeStore()
        const deps = buildForkDeps({ store: fake.store, syncEngine: {} as any, namespace: 'default' })
        deps.updateMetadata('missing', { x: 1 })
        expect(fake.captures.metadataUpdates).toEqual([])
    })
})
