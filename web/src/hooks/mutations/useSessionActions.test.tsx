import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useSessionActions } from './useSessionActions'
import { ApiError, ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import type { ForkRouteResult } from '../../../../fork-features/session-fork/rpcPayloads'

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
}

function createMockApi(reopenSession: (sessionId: string) => Promise<{ ok: true; sessionId: string; resumed: boolean }>): ApiClient {
    return { reopenSession } as unknown as ApiClient
}

beforeEach(() => {
    vi.clearAllMocks()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('useSessionActions - forkSession', () => {
    it.each(['success', 'blocked'] as const)('preserves the selected fork point and %s result while refreshing the session list', async (type) => {
        const api = new ApiClient('test-token')
        const response: ForkRouteResult = type === 'success'
            ? { type: 'success', newSessionId: 'forked-id' }
            : { type: 'blocked' }
        let sessionIds = ['src-session']
        const forkSpy = vi.spyOn(api, 'forkSession').mockImplementation(async () => {
            if (type === 'success') sessionIds = ['src-session', 'forked-id']
            return response
        })
        const listSessions = vi.fn(async () => sessionIds)
        const { result } = renderHook(() => ({
            actions: useSessionActions(api, 'src-session', 'claude'),
            sessions: useQuery({ queryKey: queryKeys.sessions, queryFn: listSessions }).data
        }), { wrapper: createWrapper() })
        await waitFor(() => expect(result.current.sessions).toEqual(['src-session']))

        let actual: ForkRouteResult | undefined
        await act(async () => {
            actual = await result.current.actions.forkSession({ forkPoint: { messageId: 'selected-message' } })
        })
        expect(forkSpy).toHaveBeenCalledWith('src-session', { forkPoint: { messageId: 'selected-message' } })
        expect(actual).toEqual(response)
        if (type === 'success') {
            await waitFor(() => expect(result.current.sessions).toEqual(['src-session', 'forked-id']))
        } else {
            expect(result.current.sessions).toEqual(['src-session'])
        }
        // Blocked is a resolved domain result; the hook refreshes the list in either case.
        expect(listSessions).toHaveBeenCalledTimes(2)
    })

    it.each(['api', 'sessionId'] as const)('rejects a fork when only %s is missing', async (missing) => {
        const api = new ApiClient('test-token')
        const forkSpy = vi.spyOn(api, 'forkSession')
        const { result } = renderHook(
            () => useSessionActions(missing === 'api' ? null : api, missing === 'sessionId' ? null : 'src-session', 'claude'),
            { wrapper: createWrapper() }
        )
        await act(async () => {
            await expect(result.current.forkSession()).rejects.toThrow('Session unavailable')
        })
        expect(forkSpy).not.toHaveBeenCalled()
    })
})

describe('useSessionActions - reopenSession', () => {
    it('invokes api.reopenSession with the session id and forwards the response', async () => {
        const reopen = vi.fn(async (_sessionId: string) => ({
            ok: true as const,
            sessionId: 'session-A-spawned',
            resumed: true
        }))
        const api = createMockApi(reopen)

        const { result } = renderHook(
            () => useSessionActions(api, 'session-A', 'cursor'),
            { wrapper: createWrapper() },
        )

        let response: { ok: true; sessionId: string; resumed: boolean } | undefined
        await act(async () => {
            response = await result.current.reopenSession()
        })

        expect(reopen).toHaveBeenCalledWith('session-A')
        // The mutation must propagate the response so the UI can navigate to the
        // possibly-new spawn id when resumeSession merges the row.
        expect(response).toEqual({ ok: true, sessionId: 'session-A-spawned', resumed: true })
    })

    it('throws when api or sessionId is missing', async () => {
        const { result } = renderHook(
            () => useSessionActions(null, null, null),
            { wrapper: createWrapper() },
        )

        await expect(result.current.reopenSession()).rejects.toThrow('Session unavailable')
    })

    it('surfaces an ApiError so the UI can render the 422 missing-metadata payload', async () => {
        const reopen = vi.fn(async () => {
            throw new ApiError(
                'HTTP 422 Unprocessable Entity: {"error":"Cursor session id is missing from metadata; reopen requires the original cursor chat id","missing":["cursorSessionId"]}',
                422,
                'Cursor session id is missing from metadata; reopen requires the original cursor chat id',
                '{"error":"Cursor session id is missing from metadata; reopen requires the original cursor chat id","missing":["cursorSessionId"]}'
            )
        })
        const api = createMockApi(reopen as unknown as ApiClient['reopenSession'])

        const { result } = renderHook(
            () => useSessionActions(api, 'session-X', 'cursor'),
            { wrapper: createWrapper() },
        )

        let captured: unknown
        await act(async () => {
            try {
                await result.current.reopenSession()
            } catch (error) {
                captured = error
            }
        })

        expect(captured).toBeInstanceOf(ApiError)
        const apiError = captured as ApiError
        expect(apiError.status).toBe(422)
        expect(apiError.body).toContain('cursorSessionId')

        await waitFor(() => {
            // The hook should not get stuck pending after the failure.
            expect(result.current.isPending).toBe(false)
        })
    })

    it('does not invalidate the source session detail when reopen returns a different id', async () => {
        const reopen = vi.fn(async () => ({
            ok: true as const,
            sessionId: 'session-B',
            resumed: true,
        }))
        const queryClient = new QueryClient({
            defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
        })
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
        const api = createMockApi(reopen)
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        )
        const { result } = renderHook(
            () => useSessionActions(api, 'session-A', 'cursor'),
            { wrapper },
        )

        await act(async () => {
            await result.current.reopenSession()
        })

        await waitFor(() => {
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sessions'] })
        })
        expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['session', 'session-A'] })
    })

    it('invalidates the source session detail when reopen returns the same id', async () => {
        const reopen = vi.fn(async () => ({
            ok: true as const,
            sessionId: 'session-A',
            resumed: true,
        }))
        const queryClient = new QueryClient({
            defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
        })
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
        const api = createMockApi(reopen)
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        )
        const { result } = renderHook(
            () => useSessionActions(api, 'session-A', 'cursor'),
            { wrapper },
        )

        await act(async () => {
            await result.current.reopenSession()
        })

        await waitFor(() => {
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ['session', 'session-A'] })
        })
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sessions'] })
    })
})

describe('useSessionActions - setModel', () => {
    it('stays pending until the refreshed session detail is available', async () => {
        let releaseSessionRefresh!: () => void
        const sessionRefresh = new Promise<void>((resolve) => {
            releaseSessionRefresh = resolve
        })
        const queryClient = new QueryClient({
            defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
        })
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(async (filters) => {
            if (JSON.stringify(filters?.queryKey) === JSON.stringify(['session', 'session-A'])) {
                await sessionRefresh
            }
        })
        const api = {
            setModel: vi.fn(async () => undefined),
        } as unknown as ApiClient
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        )
        const { result } = renderHook(
            () => useSessionActions(api, 'session-A', 'agy'),
            { wrapper },
        )

        let settled = false
        const change = result.current.setModel('gemini-3.5-flash-low').then(() => {
            settled = true
        })

        await waitFor(() => expect(api.setModel).toHaveBeenCalled())
        expect(result.current.isPending).toBe(true)
        expect(settled).toBe(false)

        releaseSessionRefresh()
        await act(async () => await change)

        expect(settled).toBe(true)
        await waitFor(() => expect(result.current.isPending).toBe(false))
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['session', 'session-A'] })
    })
})
