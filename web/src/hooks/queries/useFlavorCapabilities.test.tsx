import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useFlavorCapabilities } from './useFlavorCapabilities'
import type { ApiClient } from '@/api/client'

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    })
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
}

describe('useFlavorCapabilities', () => {
    it('returns the fork capability list', async () => {
        const api = {
            getFlavorCapabilities: vi.fn(async () => ({ fork: ['claude', 'codex'] }))
        } as unknown as ApiClient

        const { result } = renderHook(() => useFlavorCapabilities(api), { wrapper: createWrapper() })
        await waitFor(() => expect(result.current.data).toBeTruthy())
        expect(result.current.data?.fork).toEqual(['claude', 'codex'])
    })

    it('does not fire when api is null (disabled)', () => {
        const { result } = renderHook(() => useFlavorCapabilities(null), { wrapper: createWrapper() })
        expect(result.current.fetchStatus).toBe('idle')
    })
})
