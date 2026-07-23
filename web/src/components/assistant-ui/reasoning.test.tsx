import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { ReasoningGroup } from './reasoning'

const { mockUseMessage } = vi.hoisted(() => ({
    mockUseMessage: vi.fn(),
}))

vi.mock('@assistant-ui/react', () => ({
    useMessage: mockUseMessage,
}))

describe('ReasoningGroup', () => {
    beforeEach(() => {
        mockUseMessage.mockReturnValue({
            status: { type: 'complete' },
            content: [{ type: 'reasoning' }],
        })
    })

    it('keeps the collapse button sticky while expanded', () => {
        render(
            <I18nProvider>
                <ReasoningGroup><div>long reasoning</div></ReasoningGroup>
            </I18nProvider>
        )

        const button = screen.getByRole('button', { name: 'Reasoning' })
        expect(button).toHaveClass('sticky', 'top-0')
        expect(button.parentElement).not.toHaveClass('overflow-hidden')

        fireEvent.click(button)

        expect(screen.getByText('click to collapse')).toBeInTheDocument()
        expect(screen.getByText('long reasoning').parentElement?.parentElement).toHaveClass('max-h-[5000px]')
    })

    it('hides the collapse hint after the sticky button collapses the block', () => {
        render(
            <I18nProvider>
                <ReasoningGroup><div>long reasoning</div></ReasoningGroup>
            </I18nProvider>
        )

        const button = screen.getByRole('button', { name: 'Reasoning' })
        fireEvent.click(button)
        fireEvent.click(button)

        expect(screen.queryByText('click to collapse')).not.toBeInTheDocument()
        expect(screen.getByText('long reasoning').parentElement?.parentElement).toHaveClass('max-h-0')
    })
})
