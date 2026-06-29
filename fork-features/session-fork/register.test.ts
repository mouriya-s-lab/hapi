import { describe, it, expect } from 'bun:test'
import { __resetRegistryForTests, listForkCapableFlavors, getForkProvider } from './providerRegistry'

describe('register.ts', () => {
    it('registers both claude and codex providers + each exposes spawnFork', async () => {
        // Reset first so the registration we observe is exclusively from register.ts
        // and not bled-in state from a sibling test.
        __resetRegistryForTests()
        // Bust module cache so the side-effect import re-runs after the reset.
        delete require.cache[require.resolve('./register')]
        await import('./register')

        expect(listForkCapableFlavors().sort()).toEqual(['claude', 'codex'])
        expect(typeof getForkProvider('claude')?.spawnFork).toBe('function')
        expect(typeof getForkProvider('codex')?.spawnFork).toBe('function')
    })
})
