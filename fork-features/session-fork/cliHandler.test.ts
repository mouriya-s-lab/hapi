import { describe, it, expect, beforeEach } from 'bun:test'
import { handleForkSpawnSession } from './cliHandler'
import { __resetRegistryForTests, registerForkProvider } from './providerRegistry'

beforeEach(() => __resetRegistryForTests())

describe('handleForkSpawnSession', () => {
    it('dispatches to provider for the source flavor and returns its result', async () => {
        let observed: any = null
        registerForkProvider('claude', {
            async spawnFork(payload) {
                observed = payload
                return {
                    providerSessionId: 'new-id',
                    metadataPatch: { claudeSessionId: 'new-id' }
                }
            }
        })
        const result = await handleForkSpawnSession({
            flavor: 'claude',
            payload: {
                sourceMetadata: { path: '/w', host: 'h', claudeSessionId: 'src' },
                sourceCwd: '/work',
                newHapiSessionId: 'hapi-new'
            }
        })
        expect(observed.newHapiSessionId).toBe('hapi-new')
        expect(observed.sourceMetadata.claudeSessionId).toBe('src')
        expect(result.providerSessionId).toBe('new-id')
        expect(result.metadataPatch.claudeSessionId).toBe('new-id')
    })

    it('throws when no provider for flavor', async () => {
        await expect(
            handleForkSpawnSession({ flavor: 'cursor', payload: {} })
        ).rejects.toThrow(/no fork provider registered/)
    })

    it('throws when flavor is missing', async () => {
        await expect(
            handleForkSpawnSession({ flavor: '', payload: {} })
        ).rejects.toThrow(/flavor is required/)
    })

    it('throws when payload fails schema validation', async () => {
        registerForkProvider('claude', {
            async spawnFork() {
                return { providerSessionId: 'x', metadataPatch: {} }
            }
        })
        await expect(
            handleForkSpawnSession({ flavor: 'claude', payload: { sourceCwd: '/w' } })
        ).rejects.toThrow()
    })
})
