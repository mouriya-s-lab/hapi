import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import AccountSettingsPage from './AccountSettingsPage'

vi.mock('@/lib/app-context', () => ({ useAppContext: () => ({ user: { id: 2, role: 'user', defaultNamespace: 'user-ns' }, baseUrl: '', token: 'token' }) }))

describe('AccountSettingsPage', () => {
    it('loads self-service memory and tokens for a regular user', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input)
            if (url.endsWith('/api/memory')) return new Response(JSON.stringify({ memory: 'self memory' }))
            return new Response(JSON.stringify({ tokens: [{ id: 7, name: 'migrated token', namespace: 'tenant-blue', createdAt: 1 }] }))
        }))
        render(<I18nProvider><AccountSettingsPage /></I18nProvider>)
        expect(await screen.findByDisplayValue('self memory')).toBeInTheDocument()
        expect(screen.getByText('tenant-blue')).toBeInTheDocument()
        expect(fetch).toHaveBeenCalledTimes(2)
    })
})
