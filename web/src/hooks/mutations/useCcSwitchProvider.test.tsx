import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { useCcSwitchProvider } from './useCcSwitchProvider'

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
}

describe('useCcSwitchProvider', () => {
    it('restarts an active session through archive then reopen after switching', async () => {
        const calls: string[] = []
        const api = {
            switchMachineCcSwitchProvider: vi.fn(async () => {
                calls.push('switch')
                return { success: true }
            }),
            archiveSession: vi.fn(async () => {
                calls.push('archive')
            }),
            reopenSession: vi.fn(async () => {
                calls.push('reopen')
                return { ok: true, sessionId: 'session-1', resumed: true }
            }),
        } as unknown as ApiClient

        const { result } = renderHook(() => useCcSwitchProvider({
            api,
            machineId: 'machine-1',
            sessionId: 'session-1',
        }), { wrapper: createWrapper() })

        await act(async () => {
            await result.current.switchProvider('provider-1')
        })

        expect(calls).toEqual(['switch', 'archive', 'reopen'])
        expect(api.switchMachineCcSwitchProvider).toHaveBeenCalledWith('machine-1', 'provider-1')
        expect(api.archiveSession).toHaveBeenCalledWith('session-1')
        expect(api.reopenSession).toHaveBeenCalledWith('session-1')
    })
})
