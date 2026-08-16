import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { LoginPrompt } from './LoginPrompt'

function renderWithProviders(ui: React.ReactElement) {
    return render(
        <I18nProvider>
            {ui}
        </I18nProvider>
    )
}

describe('LoginPrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        const localStorageMock = {
            getItem: vi.fn(() => 'en'),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn(),
            key: vi.fn(() => null),
            length: 0,
        }
        Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true })
    })

    it('does not clear first hub URL edit when hub URL required', async () => {
        renderWithProviders(
            <LoginPrompt
                baseUrl="https://app.example.com"
                serverUrl={null}
                setServerUrl={vi.fn((value: string) => ({ ok: true as const, value }))}
                clearServerUrl={vi.fn()}
                requireServerUrl={true}
                onLogin={vi.fn()}
            />
        )

        fireEvent.change(screen.getByPlaceholderText('Access token'), { target: { value: 'token' } })
        fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

        const hubInput = await screen.findByPlaceholderText('https://hapi.example.com')
        expect(screen.getByText('Hub URL required. Please set it before signing in.')).toBeInTheDocument()

        fireEvent.change(hubInput, { target: { value: 'https://hub.example.com' } })

        expect(hubInput).toHaveValue('https://hub.example.com')
        expect(screen.queryByText('Hub URL required. Please set it before signing in.')).not.toBeInTheDocument()
    })

    it('exposes one unambiguous active login method and clears stale errors when switching', () => {
        renderWithProviders(
            <LoginPrompt
                baseUrl="https://app.example.com"
                serverUrl={null}
                setServerUrl={vi.fn((value: string) => ({ ok: true as const, value }))}
                clearServerUrl={vi.fn()}
                error="Expired password session"
                onLogin={vi.fn()}
                onPasswordLogin={vi.fn()}
            />
        )

        const passwordTab = screen.getByRole('tab', { name: 'Password' })
        const tokenTab = screen.getByRole('tab', { name: 'API token' })
        expect(passwordTab).toHaveAttribute('aria-selected', 'true')
        expect(tokenTab).toHaveAttribute('aria-selected', 'false')
        expect(screen.getByText('Expired password session')).toBeInTheDocument()

        fireEvent.click(tokenTab)

        expect(passwordTab).toHaveAttribute('aria-selected', 'false')
        expect(tokenTab).toHaveAttribute('aria-selected', 'true')
        expect(screen.queryByText('Expired password session')).not.toBeInTheDocument()
    })

    it('clears the current error as soon as the user corrects the active input', () => {
        renderWithProviders(
            <LoginPrompt
                baseUrl="https://app.example.com"
                serverUrl={null}
                setServerUrl={vi.fn((value: string) => ({ ok: true as const, value }))}
                clearServerUrl={vi.fn()}
                error="Session expired"
                onLogin={vi.fn()}
                onPasswordLogin={vi.fn()}
            />
        )

        fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'alice' } })
        expect(screen.queryByText('Session expired')).not.toBeInTheDocument()
    })
})
