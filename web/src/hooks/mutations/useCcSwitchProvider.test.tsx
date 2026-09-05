import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import { useCcSwitchProvider } from './useCcSwitchProvider'

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: { mutations: { retry: false }, queries: { retry: false, staleTime: Infinity } },
    })
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
}

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('useCcSwitchProvider', () => {
    it.each(['success', 'error'] as const)('keeps restart pending and refreshes active caches only on success: %s', async (outcome) => {
        const api = new ApiClient('test-token')
        let resolveRestart!: (sessionId: string) => void
        let rejectRestart!: (error: Error) => void
        const restart = vi.spyOn(api, 'restartSession').mockImplementation(() => new Promise<string>((resolve, reject) => {
            resolveRestart = resolve
            rejectRestart = reject
        }))
        let serverState = 'before-switch'
        const readProviders = vi.fn(async () => serverState)
        const readSession = vi.fn(async () => serverState)
        const readSessions = vi.fn(async () => serverState)
        const { result } = renderHook(() => ({
            mutation: useCcSwitchProvider({ api, machineId: 'machine-1', sessionId: 'session-1' }),
            providers: useQuery({ queryKey: queryKeys.machineCcSwitchProviders('machine-1'), queryFn: readProviders }).data,
            session: useQuery({ queryKey: queryKeys.session('session-1'), queryFn: readSession }).data,
            sessions: useQuery({ queryKey: queryKeys.sessions, queryFn: readSessions }).data
        }), { wrapper: createWrapper() })
        await waitFor(() => expect([result.current.providers, result.current.session, result.current.sessions]).toEqual([
            'before-switch', 'before-switch', 'before-switch'
        ]))

        let request!: Promise<string>
        act(() => { request = result.current.mutation.switchProvider('provider-1') })
        const settled = request.then(value => ({ value }), error => ({ error }))
        await waitFor(() => expect(result.current.mutation.isPending).toBe(true))
        expect(restart).toHaveBeenCalledWith('session-1', 'provider-1')
        expect(readProviders).toHaveBeenCalledTimes(1)
        expect(readSession).toHaveBeenCalledTimes(1)
        expect(readSessions).toHaveBeenCalledTimes(1)
        serverState = 'after-switch'
        const failure = new Error('Runner refused restart')
        await act(async () => {
            if (outcome === 'success') resolveRestart('session-2')
            else rejectRestart(failure)
            await settled
        })
        await waitFor(() => expect(result.current.mutation.isPending).toBe(false))
        if (outcome === 'success') {
            expect(await settled).toEqual({ value: 'session-2' })
            await waitFor(() => expect([result.current.providers, result.current.session, result.current.sessions]).toEqual([
                'after-switch', 'after-switch', 'after-switch'
            ]))
        } else {
            expect(await settled).toEqual({ error: failure })
            expect([result.current.providers, result.current.session, result.current.sessions]).toEqual([
                'before-switch', 'before-switch', 'before-switch'
            ])
            expect(readProviders).toHaveBeenCalledTimes(1)
            expect(readSession).toHaveBeenCalledTimes(1)
            expect(readSessions).toHaveBeenCalledTimes(1)
        }
    })
})
