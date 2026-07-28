import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import ForkSettingsPage from './ForkSettingsPage'

const navigate = vi.fn()
let role: 'admin' | 'user' = 'user'
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@/lib/app-context', () => ({ useAppContext: () => ({ user: { id: 1, role, defaultNamespace: 'ns' }, baseUrl: '', token: 't' }) }))
vi.mock('../history-import/HistoryImportSettingsRow', () => ({ HistoryImportSettingsRow: () => <button type="button">Import agent sessions</button> }))

function renderPage() {
    return render(<I18nProvider><ForkSettingsPage /></I18nProvider>)
}

describe('ForkSettingsPage', () => {
    beforeEach(() => {
        navigate.mockReset()
        role = 'user'
    })

    it('does not own account or user CRUD entries', () => {
        renderPage()
        expect(screen.queryByRole('button', { name: /User management/ })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /My account/ })).not.toBeInTheDocument()
    })

    it('keeps history import in fork settings', () => {
        renderPage()
        expect(screen.getByRole('button', { name: 'Import agent sessions' })).toBeInTheDocument()
    })

    it('hides the resource grants link from non-admins', () => {
        renderPage()
        expect(screen.queryByRole('button', { name: /Resource grants/ })).toBeNull()
    })

    it('links administrators to the resource grants page', () => {
        role = 'admin'
        renderPage()
        fireEvent.click(screen.getByRole('button', { name: /Resource grants/ }))
        expect(navigate).toHaveBeenCalledWith({ to: '/settings/fork/grants' })
    })
})
