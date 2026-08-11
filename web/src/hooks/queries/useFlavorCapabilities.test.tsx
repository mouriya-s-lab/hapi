import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useFlavorCapabilities, getFlavorForkCapability } from './useFlavorCapabilities'
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
    it('returns the two-dim per-flavor capability map', async () => {
        const api = {
            getFlavorCapabilities: vi.fn(async () => ({
                capabilities: {
                    claude: { fork: 'head-only', files: 'none' },
                    codex: { fork: 'at-message', files: 'none' },
                    cursor: { fork: 'none', files: 'none' }
                }
            }))
        } as unknown as ApiClient

        const { result } = renderHook(() => useFlavorCapabilities(api), { wrapper: createWrapper() })
        await waitFor(() => expect(result.current.data).toBeTruthy())
        expect(result.current.data?.capabilities.claude).toEqual({ fork: 'head-only', files: 'none' })
        expect(result.current.data?.capabilities.codex).toEqual({ fork: 'at-message', files: 'none' })
    })

    it('does not fire when api is null (disabled)', () => {
        const { result } = renderHook(() => useFlavorCapabilities(null), { wrapper: createWrapper() })
        expect(result.current.fetchStatus).toBe('idle')
    })
})

describe('getFlavorForkCapability', () => {
    const caps = {
        capabilities: {
            claude: { fork: 'head-only', files: 'none' } as const,
            codex: { fork: 'at-message', files: 'none' } as const,
            cursor: { fork: 'none', files: 'none' } as const
        }
    }

    it('reads by flavor', () => {
        expect(getFlavorForkCapability(caps, 'claude').fork).toBe('head-only')
        expect(getFlavorForkCapability(caps, 'codex').fork).toBe('at-message')
        expect(getFlavorForkCapability(caps, 'cursor').fork).toBe('none')
    })

    it('falls back to none for unknown flavor / missing caps / null flavor', () => {
        expect(getFlavorForkCapability(caps, 'unknown').fork).toBe('none')
        expect(getFlavorForkCapability(undefined, 'claude').fork).toBe('none')
        expect(getFlavorForkCapability(caps, null).fork).toBe('none')
    })
})
