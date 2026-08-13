import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'

// ReasoningGroup consumes `useMessage` from assistant-ui. Mock it so the
// message status/content can be controlled per test.
const { mockUseMessage, onNestedScrollFollowChange } = vi.hoisted(() => ({
    mockUseMessage: vi.fn(),
    onNestedScrollFollowChange: vi.fn(),
}))

vi.mock('@assistant-ui/react', () => ({
    useMessage: mockUseMessage,
}))

vi.mock('@/components/AssistantChat/context', () => ({
    useOptionalHappyChatContext: () => ({ onNestedScrollFollowChange }),
}))

import { ReasoningGroup } from './reasoning'

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
        cleanup()
        onNestedScrollFollowChange.mockReset()
        mockUseMessage.mockReturnValue({
            status: { type: 'complete' },
            content: [{ type: 'reasoning' }],
        })
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            callback(0)
            return 1
        })
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    })

    it('keeps the collapse button sticky while expanded', () => {
        const { container } = renderGroup()

        const button = screen.getByRole('button', { name: /Reasoning/i })
        expect(button).toHaveClass('sticky', 'top-0')
        expect(button.parentElement).not.toHaveClass('overflow-hidden')

        fireEvent.click(button)

        expect(screen.getByText('click to collapse')).toBeInTheDocument()
        expect(isCollapsed(container)).toBe(false)
    })

    it('hides the collapse hint after the sticky button collapses the block', () => {
        const { container } = renderGroup()

        const button = screen.getByRole('button', { name: /Reasoning/i })
        fireEvent.click(button)
        fireEvent.click(button)

        expect(screen.queryByText('click to collapse')).not.toBeInTheDocument()
        expect(isCollapsed(container)).toBe(true)
    })

    it('expands on click', () => {
        const { container } = renderGroup()
        const scroll = container.querySelector('.aui-reasoning-scroll') as HTMLDivElement
        expect(scroll.tabIndex).toBe(-1)
        fireEvent.click(container.querySelector('button')!)
        expect(isCollapsed(container)).toBe(false)
        expect(scroll.tabIndex).toBe(0)
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

        const scroll = container.querySelector('.aui-reasoning-scroll') as HTMLDivElement
        Object.defineProperties(scroll, {
            scrollHeight: { configurable: true, value: 500 },
            clientHeight: { configurable: true, value: 100 },
        })
        scroll.scrollTop = 100
        fireEvent.scroll(scroll)
        expect(onNestedScrollFollowChange).toHaveBeenLastCalledWith(false)

        act(() => {
            window.localStorage.setItem(STORAGE_KEY, 'true')
            window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
        })

        expect(isCollapsed(container)).toBe(true)
        expect(onNestedScrollFollowChange).toHaveBeenLastCalledWith(true)
    })

    it('opens a streaming reasoning panel at the latest content and follows new output at the bottom', () => {
        window.localStorage.setItem(STORAGE_KEY, 'true')
        setStreaming()
        const { container, rerender } = renderGroup()
        const scroll = container.querySelector('.aui-reasoning-scroll') as HTMLDivElement
        let scrollHeight = 500
        Object.defineProperties(scroll, {
            scrollHeight: { configurable: true, get: () => scrollHeight },
            clientHeight: { configurable: true, get: () => 100 },
        })

        fireEvent.click(container.querySelector('button')!)
        expect(scroll.scrollTop).toBe(500)

        scrollHeight = 700
        rerender(
            <I18nProvider>
                <ReasoningGroup>
                    <div data-testid="reasoning-content">more thinking text</div>
                </ReasoningGroup>
            </I18nProvider>
        )
        expect(scroll.scrollTop).toBe(700)
    })

    it('stops following new output after the user scrolls away from the bottom', () => {
        setStreaming()
        const { container, rerender } = renderGroup()
        const scroll = container.querySelector('.aui-reasoning-scroll') as HTMLDivElement
        let scrollHeight = 500
        Object.defineProperties(scroll, {
            scrollHeight: { configurable: true, get: () => scrollHeight },
            clientHeight: { configurable: true, get: () => 100 },
        })
        scroll.scrollTop = 100
        fireEvent.scroll(scroll)

        scrollHeight = 700
        rerender(
            <I18nProvider>
                <ReasoningGroup>
                    <div data-testid="reasoning-content">more thinking text</div>
                </ReasoningGroup>
            </I18nProvider>
        )
        expect(scroll.scrollTop).toBe(100)
    })

    it('releases nested scroll ownership when a scrolled-away panel is collapsed', () => {
        setStreaming()
        const { container } = renderGroup()
        const scroll = container.querySelector('.aui-reasoning-scroll') as HTMLDivElement
        Object.defineProperties(scroll, {
            scrollHeight: { configurable: true, value: 500 },
            clientHeight: { configurable: true, value: 100 },
        })
        scroll.scrollTop = 100
        fireEvent.scroll(scroll)
        expect(onNestedScrollFollowChange).toHaveBeenLastCalledWith(false)

        fireEvent.click(container.querySelector('button')!)

        expect(isCollapsed(container)).toBe(true)
        expect(scroll.tabIndex).toBe(-1)
        expect(onNestedScrollFollowChange).toHaveBeenLastCalledWith(true)
    })

    it('restores follow-tail after a pointer gesture ends without scrolling', () => {
        const { container } = renderGroup()
        const scroll = container.querySelector('.aui-reasoning-scroll') as HTMLDivElement
        Object.defineProperties(scroll, {
            scrollHeight: { configurable: true, value: 500 },
            clientHeight: { configurable: true, value: 100 },
        })
        scroll.scrollTop = 400

        fireEvent.pointerDown(scroll)
        fireEvent.pointerUp(window)

        expect(onNestedScrollFollowChange.mock.calls).toEqual([[false], [true]])
    })

    it('keeps nested ownership until pointer-up while reasoning continues streaming', () => {
        setStreaming()
        const { container, rerender } = renderGroup()
        const scroll = container.querySelector('.aui-reasoning-scroll') as HTMLDivElement
        let scrollHeight = 500
        Object.defineProperties(scroll, {
            scrollHeight: { configurable: true, get: () => scrollHeight },
            clientHeight: { configurable: true, get: () => 100 },
        })
        scroll.scrollTop = 400

        fireEvent.pointerDown(scroll)
        scrollHeight = 700
        rerender(
            <I18nProvider>
                <ReasoningGroup>
                    <div data-testid="reasoning-content">more thinking text</div>
                </ReasoningGroup>
            </I18nProvider>
        )
        fireEvent.scroll(scroll)

        expect(scroll.scrollTop).toBe(400)
        expect(onNestedScrollFollowChange.mock.calls).toEqual([[false], [false]])

        fireEvent.pointerUp(window)
        expect(onNestedScrollFollowChange).toHaveBeenLastCalledWith(false)
    })

    it('restores follow-tail after a boundary wheel gesture cannot scroll', () => {
        const { container } = renderGroup()
        const scroll = container.querySelector('.aui-reasoning-scroll') as HTMLDivElement
        Object.defineProperties(scroll, {
            scrollHeight: { configurable: true, value: 100 },
            clientHeight: { configurable: true, value: 100 },
        })

        fireEvent.wheel(scroll)

        expect(onNestedScrollFollowChange.mock.calls).toEqual([[false], [true]])
    })

    it('does not contain overscroll so the outer chat keeps scrolling past the panel boundary', () => {
        // Scroll chaining is native browser behavior: once the panel reaches
        // its bottom, the next wheel gesture must keep scrolling the outer
        // chat viewport. overscroll-behavior-y: contain (Tailwind
        // `overscroll-y-contain`) blocks exactly that — it was removed in
        // #1264 and must not come back (regression from #1398).
        const { container } = renderGroup()
        const scroll = container.querySelector('.aui-reasoning-scroll') as HTMLDivElement
        expect(scroll.className).not.toContain('overscroll-y-contain')
    })
})
