import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { PwaUpdateBanner, PwaUpdateBannerWithStatusOffset } from '@/components/PwaUpdateBanner'

const usePwaUpdateMock = vi.fn()
const useVoiceOptionalMock = vi.fn()

vi.mock('@/lib/pwa-update-context', () => ({
    usePwaUpdateContext: () => usePwaUpdateMock(),
}))

vi.mock('@/lib/voice-context', () => ({
    useVoiceOptional: () => useVoiceOptionalMock(),
}))

vi.mock('@/hooks/useOnlineStatus', () => ({
    useOnlineStatus: () => true,
}))

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({
        haptic: {
            impact: vi.fn(),
            notification: vi.fn(),
        },
    }),
}))

function renderBanner() {
    return render(
        <I18nProvider>
            <PwaUpdateBanner />
        </I18nProvider>,
    )
}

describe('PwaUpdateBanner', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        useVoiceOptionalMock.mockReturnValue(null)
        Object.defineProperty(window, 'localStorage', {
            value: {
                getItem: vi.fn(() => 'en'),
                setItem: vi.fn(),
                removeItem: vi.fn(),
                clear: vi.fn(),
                key: vi.fn(() => null),
                length: 0,
            },
            configurable: true,
        })
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
        }))
    })

    afterEach(() => {
        cleanup()
    })

    it('does not render when no update is available', () => {
        usePwaUpdateMock.mockReturnValue({
            needRefresh: false,
            reload: vi.fn(),
        })

        renderBanner()

        expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument()
    })

    it('renders a reload-only banner with no dismiss action', () => {
        const reload = vi.fn()

        usePwaUpdateMock.mockReturnValue({
            needRefresh: true,
            reload,
        })

        renderBanner()

        expect(screen.getByTestId('pwa-update-banner')).toBeInTheDocument()
        expect(screen.getByText('New version available')).toBeInTheDocument()
        expect(screen.getByText('Reload to get the latest HAPI')).toBeInTheDocument()
        expect(screen.getAllByRole('button')).toHaveLength(1)

        fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
        expect(reload).toHaveBeenCalledTimes(1)
    })

    it('shows only changes newer than the current build', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                version: 'next',
                commit: '2'.repeat(40),
                builtAt: '2026-07-11T00:00:00.000Z',
                entries: [
                    { hash: '2'.repeat(40), date: '2026-07-11', subject: 'new behavior' },
                    { hash: __APP_COMMIT__, date: '2026-07-10', subject: 'current behavior' },
                    { hash: '1'.repeat(40), date: '2026-07-09', subject: 'old behavior' },
                ],
            }),
        } as Response))
        usePwaUpdateMock.mockReturnValue({ needRefresh: true, reload: vi.fn() })

        renderBanner()

        await waitFor(() => expect(screen.getByText('new behavior')).toBeInTheDocument())
        expect(screen.queryByText('current behavior')).not.toBeInTheDocument()
        expect(screen.queryByText('old behavior')).not.toBeInTheDocument()
    })

    it('keeps reload available and exposes changelog failure', async () => {
        usePwaUpdateMock.mockReturnValue({ needRefresh: true, reload: vi.fn() })

        renderBanner()

        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Version changes are unavailable'))
        expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    })

    it('honors a custom top offset when provided', () => {
        usePwaUpdateMock.mockReturnValue({
            needRefresh: true,
            reload: vi.fn(),
        })

        render(
            <I18nProvider>
                <PwaUpdateBanner topClassName="top-12" />
            </I18nProvider>,
        )

        expect(screen.getByTestId('pwa-update-banner')).toHaveClass('top-12')
    })

    it('offsets below voice error banners when shown inside the voice provider', () => {
        usePwaUpdateMock.mockReturnValue({
            needRefresh: true,
            reload: vi.fn(),
        })
        useVoiceOptionalMock.mockReturnValue({
            status: 'error',
            errorMessage: 'Mic failed',
        })

        render(
            <I18nProvider>
                <PwaUpdateBannerWithStatusOffset isSyncing={false} isReconnecting={false} />
            </I18nProvider>,
        )

        expect(screen.getByTestId('pwa-update-banner')).toHaveClass(
            'top-[calc(env(safe-area-inset-top)+3rem)]'
        )
    })

    it('expands the rationale section when the disclosure is opened', () => {
        usePwaUpdateMock.mockReturnValue({
            needRefresh: true,
            reload: vi.fn(),
        })

        renderBanner()

        const disclosure = screen.getByText("Why can't I dismiss this?")
        expect(screen.queryByText(/agent running/i)).not.toBeVisible()

        fireEvent.click(disclosure)

        expect(screen.getByText(/agent running/i)).toBeVisible()
        expect(screen.getByText(/finish what you are doing first/i)).toBeVisible()
    })
})
