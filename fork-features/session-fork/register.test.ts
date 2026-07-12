import { describe, it, expect } from 'bun:test'
import { __resetRegistryForTests, listForkCapableFlavors, getForkProvider } from './providerRegistry'
import { getAllForkCapabilities } from './forkCapabilities'

describe('register.ts', () => {
    it('registers exactly the flavors whose static capability is fork-capable', async () => {
        // Pins the invariant that hub-side capability declaration
        // (FLAVOR_FORK_CAPABILITIES, served via /api/flavors/capabilities)
        // stays in sync with cli-side RPC dispatch (registry populated by
        // register.ts). Drift here = UI shows Fork for a flavor whose cli
        // handler is missing, or hides Fork for one whose handler exists.
        __resetRegistryForTests()
        delete require.cache[require.resolve('./register')]
        await import('./register')

        const expected = Object.entries(getAllForkCapabilities())
            .filter(([, cap]) => cap.fork !== 'none')
            .map(([flavor]) => flavor)
            .sort()

        expect(listForkCapableFlavors().sort()).toEqual(expected)
        for (const flavor of expected) {
            expect(typeof getForkProvider(flavor)?.spawnFork).toBe('function')
        }
    })
})
