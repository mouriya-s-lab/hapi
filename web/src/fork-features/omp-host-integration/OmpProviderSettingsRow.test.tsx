import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OmpProviderSettingsRow } from './OmpProviderSettingsRow'

const mocks = vi.hoisted(() => ({
    invalidateQueries: vi.fn(),
    queryData: {
        success: true as const,
        providers: [{
            id: 'openai-codex',
            name: 'ChatGPT Plus/Pro',
            available: true,
            authenticated: false
        }],
        flow: null
    } as {
        success: true
        providers: Array<{
            id: string
            name: string
            available: boolean
            authenticated: boolean
        }>
        flow: null
    },
    machines: [{
        id: 'machine-1',
        active: true,
        metadata: { host: 'runner', ompAvailable: true }
    }] as Array<{
        id: string
        active: boolean
        metadata: { host: string; ompAvailable?: boolean }
    }>,
    queryEnabled: false
}))

vi.mock('@tanstack/react-query', () => ({
    useQuery: (options: { enabled: boolean }) => {
        mocks.queryEnabled = options.enabled
        return {
            data: mocks.queryData,
            error: null,
            isLoading: false,
            refetch: vi.fn()
        }
    },
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries })
}))
vi.mock('@/hooks/queries/useMachines', () => ({
    useMachines: () => ({ machines: mocks.machines })
}))
vi.mock('@/lib/app-context', () => ({ useAppContext: () => ({ api: {} }) }))
vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}))

beforeEach(() => {
    mocks.invalidateQueries.mockReset()
    mocks.queryData = {
        ...mocks.queryData,
        providers: mocks.queryData.providers.map((provider) => ({
            ...provider,
            authenticated: false
        }))
    }
    mocks.machines = [{
        id: 'machine-1',
        active: true,
        metadata: { host: 'runner', ompAvailable: true }
    }]
    mocks.queryEnabled = false
})

describe('OmpProviderSettingsRow', () => {
    it('invalidates machine model catalogs when provider authentication changes', async () => {
        const view = render(<OmpProviderSettingsRow />)
        await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalled())
        mocks.invalidateQueries.mockReset()

        mocks.queryData = {
            ...mocks.queryData,
            providers: mocks.queryData.providers.map((provider) => ({
                ...provider,
                authenticated: true
            }))
        }
        view.rerender(<OmpProviderSettingsRow />)

        await waitFor(() => {
            expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['machine-omp-models'] })
        })
    })

    it('filters runners without OMP before provider discovery', async () => {
        mocks.machines = [
            {
                id: 'without-omp',
                active: true,
                metadata: { host: 'No OMP runner' }
            },
            {
                id: 'with-omp',
                active: true,
                metadata: { host: 'OMP runner', ompAvailable: true }
            }
        ]

        render(<OmpProviderSettingsRow />)
        fireEvent.click(screen.getByText('settings.fork.omp.title'))

        expect(screen.queryByRole('option', { name: 'No OMP runner' })).not.toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'OMP runner' })).toBeInTheDocument()
        await waitFor(() => expect(mocks.queryEnabled).toBe(true))
    })

    it('does not issue provider discovery when no runner supports OMP', () => {
        mocks.machines = [{
            id: 'without-omp',
            active: true,
            metadata: { host: 'No OMP runner' }
        }]

        render(<OmpProviderSettingsRow />)
        fireEvent.click(screen.getByText('settings.fork.omp.title'))

        expect(mocks.queryEnabled).toBe(false)
        expect(screen.getAllByText('settings.fork.omp.noRunners')).not.toHaveLength(0)
    })
})
