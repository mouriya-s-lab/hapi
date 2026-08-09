import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { ReasoningGroup } from './reasoning'

const { mockUseMessage } = vi.hoisted(() => ({
    mockUseMessage: vi.fn(),
}))

vi.mock('@assistant-ui/react', () => ({
    useMessage: mockUseMessage,
}))

const STORAGE_KEY = 'hapi-reasoning-collapsed'

function renderGroup() {
    return render(
        <I18nProvider>
            <ReasoningGroup><div>long reasoning</div></ReasoningGroup>
        </I18nProvider>
    )
}

function isCollapsed(container: HTMLElement): boolean {
    const region = container.querySelector('.aui-reasoning-group > div')
    return region?.className.includes('max-h-0') ?? false
}

function setStreaming() {
    mockUseMessage.mockReturnValue({
        status: { type: 'running' },
        content: [{ type: 'reasoning' }],
    })
}

describe('ReasoningGroup', () => {
    beforeEach(() => {
        window.localStorage.clear()
        mockUseMessage.mockReturnValue({
            status: { type: 'complete' },
            content: [{ type: 'reasoning' }],
        })
    })

    it('keeps the collapse button sticky while expanded', () => {
        const { container } = renderGroup()

        const button = screen.getByRole('button', { name: 'Reasoning' })
        expect(button).toHaveClass('sticky', 'top-0')
        expect(button.parentElement).not.toHaveClass('overflow-hidden')

        fireEvent.click(button)

        expect(screen.getByText('click to collapse')).toBeInTheDocument()
        expect(isCollapsed(container)).toBe(false)
    })

    it('hides the collapse hint after the sticky button collapses the block', () => {
        const { container } = renderGroup()

        const button = screen.getByRole('button', { name: 'Reasoning' })
        fireEvent.click(button)
        fireEvent.click(button)

        expect(screen.queryByText('click to collapse')).not.toBeInTheDocument()
        expect(isCollapsed(container)).toBe(true)
    })

    it('auto-expands while streaming', () => {
        const { container, rerender } = renderGroup()
        setStreaming()
        rerender(
            <I18nProvider>
                <ReasoningGroup><div>long reasoning</div></ReasoningGroup>
            </I18nProvider>
        )

        expect(isCollapsed(container)).toBe(false)
    })

    it('stays collapsed while streaming when the preference is enabled', () => {
        window.localStorage.setItem(STORAGE_KEY, 'true')
        setStreaming()
        const { container } = renderGroup()

        expect(isCollapsed(container)).toBe(true)
    })

    it('collapses an auto-expanded streaming block when the preference changes in another tab', () => {
        setStreaming()
        const { container } = renderGroup()
        expect(isCollapsed(container)).toBe(false)

        act(() => {
            window.localStorage.setItem(STORAGE_KEY, 'true')
            window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
        })

        expect(isCollapsed(container)).toBe(true)
    })
})
