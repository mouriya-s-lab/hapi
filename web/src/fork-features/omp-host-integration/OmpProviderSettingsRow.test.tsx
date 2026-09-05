import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import { OmpProviderSettingsRow } from './OmpProviderSettingsRow'
import { useOmpModelsForCwd } from './useOmpModelsForCwd'

const mocks = vi.hoisted(() => ({
    machines: [] as Array<{ id: string; active: boolean; metadata: { host: string; ompAvailable?: boolean } }>
}))
const api = new ApiClient('test-token')
vi.mock('@/hooks/queries/useMachines', () => ({ useMachines: () => ({ machines: mocks.machines }) }))
vi.mock('@/lib/app-context', () => ({ useAppContext: () => ({ api }) }))
vi.mock('@/lib/use-translation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function ModelCatalog() {
    const query = useOmpModelsForCwd({ api, machineId: 'machine-1', cwd: '/project', enabled: true })
    return <output>{query.currentModel?.modelId}</output>
}

function renderRow(withModels = false) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    const view = render(<QueryClientProvider client={client}>
        <OmpProviderSettingsRow />
        {withModels ? <ModelCatalog /> : null}
    </QueryClientProvider>)
    return { client, ...view }
}

beforeEach(() => {
    mocks.machines = [{ id: 'machine-1', active: true, metadata: { host: 'OMP runner', ompAvailable: true } }]
})
afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('OmpProviderSettingsRow', () => {
    it('refetches an active model catalog when provider authentication changes', async () => {
        let authenticated = false
        vi.spyOn(api, 'getMachineOmpLoginProviders').mockImplementation(async () => ({
            success: true,
            providers: [{ id: 'openai-codex', name: 'ChatGPT', available: true, authenticated }],
            flow: null
        }))
        const models = vi.spyOn(api, 'getMachineOmpModelsForCwd').mockImplementation(async () => ({
            success: true,
            currentModel: { provider: 'openai-codex', modelId: authenticated ? 'signed-in-model' : 'public-model' }
        }))
        const { client } = renderRow(true)
        await screen.findByText('public-model')
        await waitFor(() => expect(client.isFetching()).toBe(0))
        const initialCalls = models.mock.calls.length

        await act(async () => {
            await client.refetchQueries({ queryKey: queryKeys.machineOmpLoginProviders('machine-1') })
        })
        expect(models).toHaveBeenCalledTimes(initialCalls)

        authenticated = true
        await act(async () => {
            await client.refetchQueries({ queryKey: queryKeys.machineOmpLoginProviders('machine-1') })
        })
        await screen.findByText('signed-in-model')
        expect(models).toHaveBeenCalledWith('machine-1', '/project')
    })

    it('discovers providers only for the selected OMP-capable runner', async () => {
        mocks.machines = [
            { id: 'without-omp', active: true, metadata: { host: 'No OMP runner' } },
            ...mocks.machines,
            { id: 'second-omp', active: true, metadata: { host: 'Second OMP runner', ompAvailable: true } }
        ]
        const discover = vi.spyOn(api, 'getMachineOmpLoginProviders').mockResolvedValue({ success: true, providers: [], flow: null })
        renderRow()
        fireEvent.click(screen.getByText('settings.fork.omp.title'))
        expect(screen.queryByRole('option', { name: 'No OMP runner' })).not.toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'OMP runner' })).toBeInTheDocument()
        await waitFor(() => expect(discover.mock.calls).toEqual([['machine-1']]))
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'second-omp' } })
        await waitFor(() => expect(discover.mock.calls).toEqual([['machine-1'], ['second-omp']]))
    })

    it('does not discover providers until a capable runner becomes available', async () => {
        mocks.machines = [{ id: 'without-omp', active: true, metadata: { host: 'No OMP runner' } }]
        const discover = vi.spyOn(api, 'getMachineOmpLoginProviders').mockResolvedValue({ success: true, providers: [], flow: null })
        const { client, rerender } = renderRow()
        fireEvent.click(screen.getByText('settings.fork.omp.title'))
        expect(screen.getAllByText('settings.fork.omp.noRunners').length).toBeGreaterThan(0)
        expect(discover).not.toHaveBeenCalled()
        mocks.machines = [{ id: 'new-omp', active: true, metadata: { host: 'New OMP runner', ompAvailable: true } }]
        rerender(<QueryClientProvider client={client}><OmpProviderSettingsRow /></QueryClientProvider>)
        await waitFor(() => expect(discover.mock.calls).toEqual([['new-omp']]))
    })
})
