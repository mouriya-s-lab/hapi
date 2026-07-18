import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemorySettingsSection } from './MemorySettingsSection'

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({ baseUrl: 'http://hub', token: 'jwt' })
}))

afterEach(() => vi.unstubAllGlobals())

describe('MemorySettingsSection', () => {
    it('loads and saves the current account memory from HAPI Extensions settings', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ memory: 'ALICE-PC' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ memory: 'BOB-PC' }), { status: 200 }))
        vi.stubGlobal('fetch', fetchMock)
        render(<MemorySettingsSection />)

        const editor = await screen.findByDisplayValue('ALICE-PC')
        fireEvent.change(editor, { target: { value: ' BOB-PC ' } })
        fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
        expect(fetchMock).toHaveBeenLastCalledWith('http://hub/api/memory', expect.objectContaining({
            method: 'PATCH', body: JSON.stringify({ memory: 'BOB-PC' })
        }))
        expect(await screen.findByDisplayValue('BOB-PC')).toBeTruthy()
    })
})
