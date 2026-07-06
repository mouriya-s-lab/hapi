import { describe, it, expect } from 'bun:test'
import { __resetRegistryForTests, listForkCapableFlavors, getForkProvider } from './providerRegistry'
import { FORK_CAPABLE_FLAVORS } from './forkCapabilities'

describe('register.ts', () => {
    it('registers exactly the flavors declared in FORK_CAPABLE_FLAVORS', async () => {
        // Pins the invariant that hub-side capability declaration
        // (FORK_CAPABLE_FLAVORS, served via /api/flavors/capabilities) stays in
        // sync with cli-side RPC dispatch (registry populated by register.ts).
        // Drift here = UI shows Fork for a flavor whose cli handler is missing,
        // or hides Fork for one whose handler exists.
        __resetRegistryForTests()
        delete require.cache[require.resolve('./register')]
        await import('./register')

        expect(listForkCapableFlavors().sort()).toEqual([...FORK_CAPABLE_FLAVORS].sort())
        for (const flavor of FORK_CAPABLE_FLAVORS) {
            expect(typeof getForkProvider(flavor)?.spawnFork).toBe('function')
        }
    })
})
