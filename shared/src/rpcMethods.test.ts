import { describe, it, expect } from 'bun:test'
import { RPC_METHODS } from './rpcMethods'

describe('RPC_METHODS', () => {
    it('exposes ForkSpawnSession with kebab-case value matching codebase style', () => {
        expect(RPC_METHODS.ForkSpawnSession).toBe('fork-spawn-session')
    })
})
