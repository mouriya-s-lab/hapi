import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdminPage from './AdminPage'
import { I18nProvider } from '@/lib/i18n-context'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({ baseUrl: 'http://hub', token: 'jwt', user: { id: 1, role: 'admin', defaultNamespace: 'admin-ns' } })
}))

afterEach(() => vi.unstubAllGlobals())

describe('AdminPage account memory ownership', () => {
    it('edits the explicitly selected user through the administrator account route', async () => {
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith('/api/tokens')) return new Response(JSON.stringify({ tokens: [] }))
            if (url.endsWith('/api/machines')) return new Response(JSON.stringify({ machines: [] }))
            if (url.endsWith('/api/memory')) return new Response(JSON.stringify({ memory: 'ADMIN-MEMORY' }))
            if (url.endsWith('/api/accounts') && !init?.method) return new Response(JSON.stringify({ accounts: [
                { id: 1, username: 'admin', role: 'admin', defaultNamespace: 'admin-ns', disabledAt: null, memory: 'ADMIN-MEMORY' },
                { id: 2, username: 'bob', role: 'user', defaultNamespace: 'bob-ns', disabledAt: null, memory: 'BOB-OLD' }
            ] }))
            return new Response(JSON.stringify({ account: { id: 2, memory: 'BOB-NEW' } }))
        })
        vi.stubGlobal('fetch', fetchMock)
        render(<I18nProvider><AdminPage /></I18nProvider>)

        await screen.findByText('bob')
        const bobRow = screen.getByText('bob').closest('.rounded-lg')!
        fireEvent.click(Array.from(bobRow.querySelectorAll('button')).find(button => button.textContent === '记忆')!)
        expect(screen.getByRole('heading', { name: '用户记忆：bob' })).toBeTruthy()
        fireEvent.change(screen.getByRole('textbox', { name: '用户记忆' }), { target: { value: 'BOB-NEW' } })
        fireEvent.click(screen.getByRole('button', { name: '保存' }))

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('http://hub/api/accounts/2', expect.objectContaining({
            method: 'PATCH', body: JSON.stringify({ memory: 'BOB-NEW' })
        })))
    })
})
