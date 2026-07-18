import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import ForkSettingsPage from './ForkSettingsPage'

const navigate = vi.fn()
let role: 'admin' | 'user' = 'admin'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@/lib/app-context', () => ({ useAppContext: () => ({ user: { role } }) }))
vi.mock('../history-import/HistoryImportSettingsRow', () => ({ HistoryImportSettingsRow: () => <button type="button">Import agent sessions</button> }))

function renderPage() {
    return render(<I18nProvider><ForkSettingsPage /></I18nProvider>)
}

describe('ForkSettingsPage', () => {
    beforeEach(() => {
        navigate.mockReset()
        role = 'admin'
    })

    it('shows user management only to administrators', () => {
        const view = renderPage()
        fireEvent.click(screen.getByRole('button', { name: /User management/ }))
        expect(navigate).toHaveBeenCalledWith({ to: '/settings/fork/users' })

        role = 'user'
        view.rerender(<I18nProvider><ForkSettingsPage /></I18nProvider>)
        expect(screen.queryByRole('button', { name: /User management/ })).not.toBeInTheDocument()
    })

    it('keeps history import in fork settings', () => {
        renderPage()
        expect(screen.getByRole('button', { name: 'Import agent sessions' })).toBeInTheDocument()
    })
})
