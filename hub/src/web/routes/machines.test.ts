import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Machine, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createMachinesRoutes } from './machines'
import { RpcTargetMissingError } from '../../sync/rpcGateway'

function createMachine(overrides?: Partial<Machine>): Machine {
    return {
        id: 'machine-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            host: 'localhost',
            platform: 'darwin',
            happyCliVersion: '1.0.0'
        },
        metadataVersion: 1,
        runnerState: null,
        runnerStateVersion: 1,
        ...overrides
    }
}

function createOmpMachine(): Machine {
    const machine = createMachine()
    return {
        ...machine,
        metadata: {
            ...machine.metadata!,
            capabilities: { omp: true }
        }
    }
}

describe('machines routes', () => {
    it('forwards the read-only cc-switch provider list', async () => {
        const machine = createMachine()
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listCcSwitchProvidersForMachine: async () => ({ success: true, available: true, providers: [] })
        } as Partial<SyncEngine>
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => { c.set('namespace', 'default'); await next() })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine))

        expect(await (await app.request('/api/machines/machine-1/cc-switch/providers')).json())
            .toEqual({ success: true, available: true, providers: [] })
    })
    it('forwards create-directory requests to the selected machine', async () => {
        const machine = createMachine()
        const calls: Array<{ machineId: string; parentPath: string; name: string }> = []
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            createMachineDirectory: async (machineId: string, parentPath: string, name: string) => {
                calls.push({ machineId, parentPath, name })
                return { success: true, path: `${parentPath}/${name}` }
            }
        } as Partial<SyncEngine>
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/machines/machine-1/create-directory', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ parentPath: '/workspace', name: 'new-project' })
        })

        expect(response.status).toBe(200)
        expect(calls).toEqual([{ machineId: 'machine-1', parentPath: '/workspace', name: 'new-project' }])
        expect(await response.json()).toEqual({ success: true, path: '/workspace/new-project' })
    })

    it('returns Codex models for an online machine', async () => {
        const machine = createMachine()
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listCodexModelsForMachine: async () => ({
                success: true,
                models: [
                    { id: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true }
                ]
            })
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/machines/machine-1/codex-models')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: true,
            models: [
                { id: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true }
            ]
        })
    })

    it('returns 400 when /opencode-models is called without cwd', async () => {
        const machine = createMachine()
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listOpencodeModelsForCwd: async () => ({ success: true, availableModels: [] })
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/machines/machine-1/opencode-models')

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            success: false,
            error: 'cwd query parameter is required'
        })
    })

    it('forwards cwd to listOpencodeModelsForCwd and returns availableModels', async () => {
        const machine = createMachine()
        const calls: Array<{ machineId: string; cwd: string }> = []
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listOpencodeModelsForCwd: async (machineId: string, cwd: string) => {
                calls.push({ machineId, cwd })
                return {
                    success: true,
                    availableModels: [
                        { modelId: 'ollama/exaone:4.5-33b-q8', name: 'Ollama/EXAONE 4.5 33B Q8' }
                    ],
                    currentModelId: 'ollama/exaone:4.5-33b-q8'
                }
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine))

        const response = await app.request(
            '/api/machines/machine-1/opencode-models?cwd=' + encodeURIComponent('/home/user/proj')
        )

        expect(response.status).toBe(200)
        expect(calls).toEqual([{ machineId: 'machine-1', cwd: '/home/user/proj' }])
        expect(await response.json()).toEqual({
            success: true,
            availableModels: [
                { modelId: 'ollama/exaone:4.5-33b-q8', name: 'Ollama/EXAONE 4.5 33B Q8' }
            ],
            currentModelId: 'ollama/exaone:4.5-33b-q8'
        })
    })

    it('returns 503 when cursor-models is requested without a sync engine', async () => {
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => null))

        const response = await app.request('/api/machines/machine-1/cursor-models')

        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({
            success: false,
            error: 'Not connected'
        })
    })

    it('returns 500 when listing Cursor models fails', async () => {
        const machine = createMachine()
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listCursorModelsForMachine: async () => {
                throw new Error('rpc offline')
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/machines/machine-1/cursor-models')

        expect(response.status).toBe(500)
        expect(await response.json()).toEqual({
            success: false,
            error: 'rpc offline'
        })
    })

    it('returns Cursor models for an online machine', async () => {
        const machine = createMachine()
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listCursorModelsForMachine: async () => ({
                success: true,
                availableModels: [
                    { modelId: 'composer-2.5', name: 'Composer 2.5' },
                    { modelId: 'gpt-5.5-high-fast', name: 'GPT-5.5 High Fast' }
                ],
                currentModelId: 'composer-2.5'
            })
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/machines/machine-1/cursor-models')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: true,
            availableModels: [
                { modelId: 'composer-2.5', name: 'Composer 2.5' },
                { modelId: 'gpt-5.5-high-fast', name: 'GPT-5.5 High Fast' }
            ],
            currentModelId: 'composer-2.5'
        })
    })

    it('returns ACP wire ids from the machine RPC for New Session model pickers', async () => {
        const machine = createMachine()
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listCursorModelsForMachine: async () => ({
                success: true,
                availableModels: [
                    { modelId: 'composer-2.5[fast=true]', name: 'composer-2.5' },
                    { modelId: 'composer-2.5[fast=false]', name: 'composer-2.5' }
                ],
                currentModelId: 'composer-2.5[fast=true]'
            })
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/machines/machine-1/cursor-models')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: true,
            availableModels: [
                { modelId: 'composer-2.5[fast=true]', name: 'composer-2.5' },
                { modelId: 'composer-2.5[fast=false]', name: 'composer-2.5' }
            ],
            currentModelId: 'composer-2.5[fast=true]'
        })
    })

    it('forwards OMP model discovery with the selected workspace', async () => {
        const machine = createOmpMachine()
        const calls: Array<{ machineId: string; cwd: string }> = []
        const result = {
            success: true as const,
            availableModels: [{
                provider: 'openai-codex',
                modelId: 'gpt-5.6-sol',
                name: 'GPT-5.6-Sol',
                reasoning: true,
                contextWindow: 272_000,
                maxTokens: 128_000,
                thinkingLevels: ['high' as const]
            }],
            currentModel: null
        }
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listOmpModelsForMachine: async (machineId: string, cwd: string) => {
                calls.push({ machineId, cwd })
                return result
            }
        } as Partial<SyncEngine>
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine))

        const response = await app.request(
            '/api/machines/machine-1/omp-models?cwd=' + encodeURIComponent('/workspace/project')
        )

        expect(response.status).toBe(200)
        expect(calls).toEqual([{ machineId: 'machine-1', cwd: '/workspace/project' }])
        expect(await response.json()).toEqual(result)
    })

    it('keeps OMP provider login and required input on the machine RPC', async () => {
        const machine = createOmpMachine()
        const flowId = '00000000-0000-4000-8000-000000000001'
        const calls: Array<Record<string, string>> = []
        const provider = {
            id: 'openai-codex',
            name: 'ChatGPT Plus/Pro',
            available: true,
            authenticated: false
        }
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listOmpLoginProvidersForMachine: async (machineId: string) => {
                calls.push({ action: 'list', machineId })
                return { success: true as const, providers: [provider], flow: null }
            },
            startOmpLoginForMachine: async (machineId: string, providerId: string) => {
                calls.push({ action: 'start', machineId, providerId })
                return {
                    success: true as const,
                    flow: {
                        flowId,
                        providerId,
                        providerName: provider.name,
                        status: 'waiting_for_input' as const,
                        title: 'Paste the authorization code'
                    }
                }
            },
            respondOmpLoginInputForMachine: async (machineId: string, submittedFlowId: string, value: string) => {
                calls.push({ action: 'respond', machineId, flowId: submittedFlowId, value })
                return {
                    success: true as const,
                    flow: {
                        flowId: submittedFlowId,
                        providerId: provider.id,
                        providerName: provider.name,
                        status: 'authenticated' as const
                    }
                }
            }
        } as Partial<SyncEngine>
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine))

        const providersResponse = await app.request('/api/machines/machine-1/omp-login-providers')
        const startResponse = await app.request('/api/machines/machine-1/omp-login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ providerId: provider.id })
        })
        const inputResponse = await app.request('/api/machines/machine-1/omp-login-input', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ flowId, value: 'authorization-code' })
        })

        expect(providersResponse.status).toBe(200)
        expect(await providersResponse.json()).toEqual({ success: true, providers: [provider], flow: null })
        expect(startResponse.status).toBe(200)
        expect(await startResponse.json()).toMatchObject({
            success: true,
            flow: { flowId, status: 'waiting_for_input' }
        })
        expect(inputResponse.status).toBe(200)
        expect(await inputResponse.json()).toMatchObject({
            success: true,
            flow: { flowId, status: 'authenticated' }
        })
        expect(calls).toEqual([
            { action: 'list', machineId: 'machine-1' },
            { action: 'start', machineId: 'machine-1', providerId: provider.id },
            { action: 'respond', machineId: 'machine-1', flowId, value: 'authorization-code' }
        ])
    })

    it('rejects runners without OMP before invoking machine RPC', async () => {
        const machine = createMachine()
        let invoked = false
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listOmpLoginProvidersForMachine: async () => {
                invoked = true
                return { success: true as const, providers: [], flow: null }
            }
        } as Partial<SyncEngine>
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/machines/machine-1/omp-login-providers')

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            success: false,
            error: 'OMP is not available on this runner'
        })
        expect(invoked).toBe(false)
    })

    it('maps a stale OMP capability with a missing handler to conflict', async () => {
        const machine = createOmpMachine()
        const engine = {
            getMachine: () => machine,
            getMachineByNamespace: () => machine,
            listOmpLoginProvidersForMachine: async () => {
                throw new RpcTargetMissingError(
                    'machine-1:listOmpLoginProviders',
                    'handler-not-registered'
                )
            }
        } as Partial<SyncEngine>
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createMachinesRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/machines/machine-1/omp-login-providers')

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            success: false,
            error: 'OMP is not available on this runner'
        })
    })
})
