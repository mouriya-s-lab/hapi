import type { ReactElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { OmpModelRefreshRow } from './OmpModelRefreshRow'

function renderInProviders(ui: ReactElement) {
    return render(<I18nProvider>{ui}</I18nProvider>)
}

describe('OmpModelRefreshRow', () => {
    afterEach(() => {
        cleanup()
    })

    it('calls onRefresh without requiring a model change', () => {
        const onRefresh = vi.fn()
        renderInProviders(
            <OmpModelRefreshRow
                refreshing={false}
                error={null}
                empty={false}
                disabled={false}
                onRefresh={onRefresh}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }))
        expect(onRefresh).toHaveBeenCalledOnce()
    })

    it('shows refreshing label and disables the row', () => {
        const onRefresh = vi.fn()
        renderInProviders(
            <OmpModelRefreshRow
                refreshing
                error={null}
                empty={false}
                disabled={false}
                onRefresh={onRefresh}
            />
        )

        const button = screen.getByRole('button', { name: 'Refreshing…' })
        expect(button).toBeDisabled()
        fireEvent.click(button)
        expect(onRefresh).not.toHaveBeenCalled()
    })

    it('keeps the refresh row when the catalog is empty or failed', () => {
        const { rerender } = renderInProviders(
            <OmpModelRefreshRow
                refreshing={false}
                error="OMP models unavailable"
                empty
                disabled={false}
                onRefresh={vi.fn()}
            />
        )

        expect(screen.getByRole('button', { name: 'Refresh models' })).toBeInTheDocument()
        expect(screen.getByTestId('omp-refresh-models-error')).toHaveTextContent('OMP models unavailable')
        expect(screen.queryByTestId('omp-refresh-models-empty')).not.toBeInTheDocument()

        rerender(
            <I18nProvider>
                <OmpModelRefreshRow
                    refreshing={false}
                    error={null}
                    empty
                    disabled={false}
                    onRefresh={vi.fn()}
                />
            </I18nProvider>
        )
        expect(screen.getByTestId('omp-refresh-models-empty')).toHaveTextContent('No OMP models discovered')
    })
})
