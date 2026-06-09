import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../src/index.css'
import { I18nProvider } from '../src/lib/i18n-context'
import { NewSession } from '../src/components/NewSession'
import type { ApiClient } from '../src/api/client'
import type { AgentFlavor } from '@hapi/protocol'
import type { Machine, SpawnResponse } from '../src/types/api'

const MACHINE_ID = 'machine-omp'
const DIRECTORY = '/tmp/hapi-omp-project'
const OMP_MODEL = 'mlx/qwen3:32b'

type ModelProbeCall = {
    machineId: string
    cwd: string
    agent: 'opencode' | 'omp'
}

type SpawnCall = {
    machineId: string
    directory: string
    agent?: AgentFlavor
    model?: string
}

declare global {
    interface Window {
        __newSessionOmpFixture: {
            modelProbeCalls: ModelProbeCall[]
            spawnCalls: SpawnCall[]
        }
    }
}

window.__newSessionOmpFixture = {
    modelProbeCalls: [],
    spawnCalls: []
}

try {
    localStorage.setItem('hapi:newSession:agent', 'omp')
} catch {
    // ignore storage failures in fixture environments
}

const machine: Machine = {
    id: MACHINE_ID,
    namespace: 'default',
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    active: true,
    activeAt: 1,
    metadata: {
        host: 'fixture-host',
        platform: 'darwin',
        happyCliVersion: '0.0.0',
        displayName: 'OMP fixture'
    },
    metadataVersion: 1,
    runnerState: { status: 'running' },
    runnerStateVersion: 1
}

const api = {
    getSessions: async () => ({ sessions: [] }),
    checkMachinePathsExists: async (_machineId: string, paths: string[]) => ({
        success: true,
        exists: Object.fromEntries(paths.map((path) => [path, true]))
    }),
    getMachineOpencodeModelsForCwd: async (
        machineId: string,
        cwd: string,
        agent: 'opencode' | 'omp' = 'opencode'
    ) => {
        window.__newSessionOmpFixture.modelProbeCalls.push({ machineId, cwd, agent })
        return {
            success: true,
            availableModels: [
                { modelId: OMP_MODEL, name: 'MLX/Qwen 3.6 32B Q8' },
                { modelId: 'ollama/exaone:4.5-33b-q8', name: 'Ollama/EXAONE 4.5 33B Q8' }
            ],
            currentModelId: OMP_MODEL
        }
    },
    spawnSession: async (
        machineId: string,
        directory: string,
        agent?: AgentFlavor,
        model?: string
    ): Promise<SpawnResponse> => {
        window.__newSessionOmpFixture.spawnCalls.push({ machineId, directory, agent, model })
        return { type: 'success', sessionId: 'new-omp-session' }
    }
} as unknown as ApiClient

const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } }
})

function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <div data-testid="new-session-omp-host">
                    <NewSession
                        api={api}
                        machines={[machine]}
                        initialMachineId={MACHINE_ID}
                        initialDirectory={DIRECTORY}
                        onSuccess={() => {}}
                        onCancel={() => {}}
                    />
                </div>
            </I18nProvider>
        </QueryClientProvider>
    )
}

const rootEl = document.getElementById('root')
if (rootEl) {
    ReactDOM.createRoot(rootEl).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    )
}
