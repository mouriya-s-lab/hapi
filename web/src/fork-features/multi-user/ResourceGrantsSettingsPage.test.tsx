import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { ResourceGrantsSettingsPage } from './ResourceGrantsSettingsSection'

vi.mock('@/lib/app-context', () => ({ useAppContext: () => ({ baseUrl: 'http://hub', token: 'jwt', user: { id: 1 } }) }))

afterEach(() => vi.unstubAllGlobals())

describe('ResourceGrantsSettingsPage', () => {
    it('separates resource types into browsable lists instead of one mixed selector', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/api/sessions') ? {
            sessions: [{ id: 's1', metadata: { name: 'Checkout', path: '/repo' } }]
        } : { machines: [{ id: 'm1', metadata: { displayName: 'Runner' } }] }), { status: 200 })))
        render(<I18nProvider><ResourceGrantsSettingsPage /></I18nProvider>)

        expect(await screen.findByRole('button', { name: /Checkout/ })).toBeTruthy()
        expect(screen.queryByRole('button', { name: /Runner/ })).toBeNull()

        fireEvent.click(screen.getByRole('radio', { name: 'Directories' }))
        expect(screen.getByRole('button', { name: /\/repo/ })).toBeTruthy()

        fireEvent.click(screen.getByRole('radio', { name: 'Machines' }))
        expect(screen.getByRole('button', { name: /Runner/ })).toBeTruthy()
    })
})
