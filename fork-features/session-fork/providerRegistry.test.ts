import { describe, it, expect, beforeEach } from 'bun:test'
import {
    registerForkProvider,
    getForkProvider,
    listForkCapableFlavors,
    __resetRegistryForTests,
    type ForkProvider
} from './providerRegistry'

const fakeProvider: ForkProvider = {
    async spawnFork() {
        return { providerSessionId: 'x', metadataPatch: {} }
    }
}

beforeEach(() => __resetRegistryForTests())

describe('providerRegistry', () => {
    it('registers and retrieves a provider', () => {
        registerForkProvider('claude', fakeProvider)
        expect(getForkProvider('claude')).toBe(fakeProvider)
    })

    it('returns undefined for unregistered flavor', () => {
        expect(getForkProvider('cursor')).toBeUndefined()
    })

    it('listForkCapableFlavors returns registered flavors', () => {
        registerForkProvider('claude', fakeProvider)
        registerForkProvider('codex', fakeProvider)
        expect(listForkCapableFlavors().sort()).toEqual(['claude', 'codex'])
    })

    it('listForkCapableFlavors is empty after reset', () => {
        registerForkProvider('claude', fakeProvider)
        __resetRegistryForTests()
        expect(listForkCapableFlavors()).toEqual([])
    })
})
