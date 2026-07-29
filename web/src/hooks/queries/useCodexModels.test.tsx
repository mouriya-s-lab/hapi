import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { useCodexModels } from './useCodexModels'

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    })
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
}

describe('useCodexModels', () => {
    it('loads the catalog from the target machine', async () => {
        const getMachineCodexModels = vi.fn(async () => ({
            success: true,
            models: [{ id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', isDefault: true }]
        }))
        const api = { getMachineCodexModels } as unknown as ApiClient

        const { result } = renderHook(() => useCodexModels({
            api,
            machineId: 'machine-1',
            enabled: true
        }), { wrapper: createWrapper() })

        await waitFor(() => expect(result.current.models).toHaveLength(1))
        expect(getMachineCodexModels).toHaveBeenCalledWith('machine-1')
    })

    it('does not query without a machine identity', () => {
        const getMachineCodexModels = vi.fn()
        const api = { getMachineCodexModels } as unknown as ApiClient

        const { result } = renderHook(() => useCodexModels({
            api,
            machineId: null,
            enabled: true
        }), { wrapper: createWrapper() })

        expect(result.current.isLoading).toBe(false)
        expect(getMachineCodexModels).not.toHaveBeenCalled()
    })
})
