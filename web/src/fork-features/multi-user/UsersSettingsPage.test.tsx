import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import UsersSettingsPage from './UsersSettingsPage'

const navigate = vi.fn()
let role: 'admin' | 'user' = 'admin'
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    Navigate: (props: { to: string; replace?: boolean }) => <div data-testid="redirect">{props.to}:{String(props.replace)}</div>,
}))
vi.mock('@/lib/app-context', () => ({ useAppContext: () => ({ user: { role }, baseUrl: '', token: 'token' }) }))

describe('UsersSettingsPage', () => {
    beforeEach(() => {
        role = 'admin'
        navigate.mockReset()
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ accounts: [] }))))
    })

    it('redirects a regular user away from the admin route', () => {
        role = 'user'
        render(<I18nProvider><UsersSettingsPage /></I18nProvider>)
        expect(screen.getByTestId('redirect')).toHaveTextContent('/settings:true')
        expect(fetch).not.toHaveBeenCalled()
    })

    it('navigates from the administrator list to create user', async () => {
        render(<I18nProvider><UsersSettingsPage /></I18nProvider>)
        const button = await screen.findByRole('button', { name: 'Create user' })
        fireEvent.click(button)
        await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/settings/users/$accountId', params: { accountId: 'new' } }))
    })
})
