import { render, waitFor } from '@testing-library/react'
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
    }
}))

vi.mock('@tanstack/react-query', () => ({
    useQuery: () => ({
        data: mocks.queryData,
        error: null,
        isLoading: false,
        refetch: vi.fn()
    }),
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries })
}))
vi.mock('@/hooks/queries/useMachines', () => ({
    useMachines: () => ({
        machines: [{ id: 'machine-1', active: true, metadata: { host: 'runner' } }]
    })
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
})
