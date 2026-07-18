import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import { I18nProvider } from '@/lib/i18n-context'
import { OmpLoginBanner } from './OmpLoginBanner'

afterEach(() => cleanup())

function renderBanner(api: ApiClient, enabled = true) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false }
        }
    })
    const Wrapper = (props: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <I18nProvider>{props.children}</I18nProvider>
        </QueryClientProvider>
    )
    return render(
        <OmpLoginBanner api={api} sessionId="omp-session" enabled={enabled} />,
        { wrapper: Wrapper }
    )
}

describe('OmpLoginBanner', () => {
    it('stays inert outside an active remote OMP session', () => {
        const getSessionOmpLoginProviders = vi.fn()
        renderBanner({ getSessionOmpLoginProviders } as unknown as ApiClient, false)

        expect(screen.queryByTestId('omp-login-banner')).toBeNull()
        expect(getSessionOmpLoginProviders).not.toHaveBeenCalled()
    })

    it('starts provider login and refreshes the authenticated provider state', async () => {
        let authenticated = false
        const getSessionOmpLoginProviders = vi.fn(async () => ({
            success: true as const,
            providers: [{
                id: 'example',
                name: 'Example OAuth',
                available: true,
                authenticated
            }],
            loginInProgress: false
        }))
        const startSessionOmpLogin = vi.fn(async () => {
            authenticated = true
            return {
                success: true as const,
                provider: {
                    id: 'example',
                    name: 'Example OAuth',
                    available: true,
                    authenticated: true
                },
                providers: [{
                    id: 'example',
                    name: 'Example OAuth',
                    available: true,
                    authenticated: true
                }]
            }
        })
        renderBanner({
            getSessionOmpLoginProviders,
            startSessionOmpLogin
        } as unknown as ApiClient)

        const provider = await screen.findByRole('combobox', { name: 'Choose a provider' })
        fireEvent.change(provider, { target: { value: 'example' } })
        const action = screen.getByRole('button', { name: 'Sign in to Example OAuth' })
        fireEvent.click(action)

        await waitFor(() => {
            expect(startSessionOmpLogin).toHaveBeenCalledWith('omp-session', 'example')
            expect(screen.getByText('Signed in: Example OAuth')).toBeTruthy()
        })
        expect(getSessionOmpLoginProviders).toHaveBeenCalledTimes(2)
        expect(screen.queryByRole('button', { name: 'Sign in to Example OAuth' })).toBeNull()
    })

    it('keeps a large provider catalog in one compact selector', async () => {
        const providers = Array.from({ length: 40 }, (_, index) => ({
            id: `provider-${index}`,
            name: `Provider ${index}`,
            available: true,
            authenticated: false
        }))
        renderBanner({
            getSessionOmpLoginProviders: vi.fn(async () => ({
                success: true as const,
                providers,
                loginInProgress: false
            }))
        } as unknown as ApiClient)

        const selector = await screen.findByRole('combobox', { name: 'Choose a provider' })
        expect(selector.querySelectorAll('option')).toHaveLength(41)
        expect(screen.getAllByRole('button')).toHaveLength(1)
    })

    it('surfaces provider discovery failures without offering a login action', async () => {
        const api = {
            getSessionOmpLoginProviders: vi.fn(async () => ({
                success: false as const,
                error: 'provider registry unavailable'
            }))
        } as unknown as ApiClient
        renderBanner(api)

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'OMP sign-in failed: provider registry unavailable'
        )
        expect(screen.queryByRole('button')).toBeNull()
    })
})
