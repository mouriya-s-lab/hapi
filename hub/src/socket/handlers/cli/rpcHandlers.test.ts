import { describe, expect, it } from 'bun:test'
import { registerRpcHandlers } from './rpcHandlers'

describe('CLI RPC registration authorization', () => {
    it('registers only methods whose resource prefix is operable by the socket account', () => {
        const handlers = new Map<string, (data: unknown) => void>()
        const registered: string[] = []
        const socket = { on: (event: string, handler: (data: unknown) => void) => { handlers.set(event, handler) } }
        const registry = { register: (_socket: unknown, method: string) => { registered.push(method) }, unregister: () => {} }
        registerRpcHandlers(socket as never, registry as never, (resourceId) => resourceId === 'owned')

        handlers.get('rpc-register')?.({ method: 'viewer:spawn-session' })
        handlers.get('rpc-register')?.({ method: 'owned:spawn-session' })

        expect(registered).toEqual(['owned:spawn-session'])
    })
})
