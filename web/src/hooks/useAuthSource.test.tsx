import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthSource } from './useAuthSource'

describe('useAuthSource password sessions', () => {
    beforeEach(() => {
        localStorage.clear()
        window.history.replaceState(null, '', '/')
    })

    it('keeps password auth source stable and restores its persisted JWT', async () => {
        const baseUrl = 'http://hub.test'
        const first = renderHook(() => useAuthSource(baseUrl))
        await waitFor(() => expect(first.result.current.isLoading).toBe(false))

        act(() => first.result.current.setPasswordToken('jwt-1'))
        const stableSource = first.result.current.authSource
        first.rerender()
        expect(first.result.current.authSource).toBe(stableSource)

        first.unmount()
        const restored = renderHook(() => useAuthSource(baseUrl))
        await waitFor(() => expect(restored.result.current.isLoading).toBe(false))
        expect(restored.result.current.authSource).toEqual({ type: 'password', token: 'jwt-1' })
    })

    it('keeps access-token and password sessions mutually exclusive', async () => {
        const hook = renderHook(() => useAuthSource('http://hub.test'))
        await waitFor(() => expect(hook.result.current.isLoading).toBe(false))

        act(() => hook.result.current.setPasswordToken('jwt'))
        act(() => hook.result.current.setAccessToken('api-token'))
        hook.unmount()

        const restored = renderHook(() => useAuthSource('http://hub.test'))
        await waitFor(() => expect(restored.result.current.isLoading).toBe(false))
        expect(restored.result.current.authSource).toEqual({ type: 'accessToken', token: 'api-token' })
    })
})
