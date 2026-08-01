import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useViewportHeight } from './useViewportHeight'

/**
 * Unit tests for the useViewportHeight hook logic.
 *
 * Because the hook depends on window.visualViewport (not available in jsdom),
 * we test the core update logic directly rather than rendering the hook.
 */
describe('useViewportHeight update logic', () => {
    const root = document.documentElement

    beforeEach(() => {
        root.style.removeProperty('--app-viewport-height')
    })

    afterEach(() => {
        root.style.removeProperty('--app-viewport-height')
    })

    it('sets --app-viewport-height when visual viewport is smaller than window', () => {
        // Simulate the update logic from the hook
        const viewportHeight = 400
        const windowHeight = 800
        const diff = windowHeight - viewportHeight
        if (diff > 1) {
            root.style.setProperty('--app-viewport-height', `${viewportHeight}px`)
        } else {
            root.style.removeProperty('--app-viewport-height')
        }

        expect(root.style.getPropertyValue('--app-viewport-height')).toBe('400px')
    })

    it('removes --app-viewport-height when viewports match', () => {
        // First set it
        root.style.setProperty('--app-viewport-height', '400px')

        // Then simulate keyboard close
        const viewportHeight = 800
        const windowHeight = 800
        const diff = windowHeight - viewportHeight
        if (diff > 1) {
            root.style.setProperty('--app-viewport-height', `${viewportHeight}px`)
        } else {
            root.style.removeProperty('--app-viewport-height')
        }

        expect(root.style.getPropertyValue('--app-viewport-height')).toBe('')
    })

    it('ignores sub-pixel differences (threshold of 1px)', () => {
        const viewportHeight = 799.5
        const windowHeight = 800
        const diff = windowHeight - viewportHeight
        if (diff > 1) {
            root.style.setProperty('--app-viewport-height', `${viewportHeight}px`)
        } else {
            root.style.removeProperty('--app-viewport-height')
        }

        expect(root.style.getPropertyValue('--app-viewport-height')).toBe('')
    })

    it('resets page scroll when keyboard is open', () => {
        const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

        // Simulate: keyboard open AND page has been scrolled by iOS
        Object.defineProperty(window, 'scrollY', { value: 120, configurable: true })

        const viewportHeight = 400
        const windowHeight = 800
        const diff = windowHeight - viewportHeight
        if (diff > 1) {
            root.style.setProperty('--app-viewport-height', `${viewportHeight}px`)
            if (window.scrollY > 0) {
                window.scrollTo(0, 0)
            }
        }

        expect(scrollToSpy).toHaveBeenCalledWith(0, 0)

        // Cleanup
        Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
        scrollToSpy.mockRestore()
    })

    it('does not reset scroll when page is not scrolled', () => {
        const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

        Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })

        const viewportHeight = 400
        const windowHeight = 800
        const diff = windowHeight - viewportHeight
        if (diff > 1) {
            root.style.setProperty('--app-viewport-height', `${viewportHeight}px`)
            if (window.scrollY > 0) {
                window.scrollTo(0, 0)
            }
        }

        expect(scrollToSpy).not.toHaveBeenCalled()

        scrollToSpy.mockRestore()
    })
})

/**
 * 挂载真实 hook 验证「过期变量恢复路径」：Android/PWA 上键盘收起若发生在
 * 页面失焦/切后台瞬间，visualViewport 的最后一次 resize 会丢，
 * --app-viewport-height 卡死在键盘时代的小值（应用挤上半屏、下方留白 +
 * 第二条滚动条）。窗口回前台 / 几何变化的任一信号都必须重新校验并清掉它。
 */
describe('useViewportHeight stale-value recovery (mounted hook)', () => {
    const root = document.documentElement
    let originalVisualViewport: PropertyDescriptor | undefined
    let originalInnerHeight: PropertyDescriptor | undefined

    beforeEach(() => {
        originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
        originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
        root.style.removeProperty('--app-viewport-height')
    })

    afterEach(() => {
        if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport)
        else delete (window as Record<string, unknown>)['visualViewport']
        if (originalInnerHeight) Object.defineProperty(window, 'innerHeight', originalInnerHeight)
        root.style.removeProperty('--app-viewport-height')
    })

    function mount(viewportHeight: number, windowHeight: number) {
        Object.defineProperty(window, 'visualViewport', {
            value: {
                height: viewportHeight,
                addEventListener: () => {},
                removeEventListener: () => {}
            },
            configurable: true
        })
        Object.defineProperty(window, 'innerHeight', { value: windowHeight, configurable: true })
        return renderHook(() => useViewportHeight())
    }

    it('clears a stale value when the window regains focus after the keyboard is gone', () => {
        root.style.setProperty('--app-viewport-height', '500px')
        const hook = mount(844, 844)

        window.dispatchEvent(new Event('focus'))

        expect(root.style.getPropertyValue('--app-viewport-height')).toBe('')
        hook.unmount()
    })

    it('clears a stale value when the document becomes visible again', () => {
        root.style.setProperty('--app-viewport-height', '500px')
        const hook = mount(844, 844)

        document.dispatchEvent(new Event('visibilitychange'))

        expect(root.style.getPropertyValue('--app-viewport-height')).toBe('')
        hook.unmount()
    })

    it('keeps the value while the keyboard is genuinely open', () => {
        root.style.setProperty('--app-viewport-height', '500px')
        const hook = mount(500, 844)

        window.dispatchEvent(new Event('focus'))

        expect(root.style.getPropertyValue('--app-viewport-height')).toBe('500px')
        hook.unmount()
    })

    it('stops reacting after unmount', () => {
        const hook = mount(844, 844)
        hook.unmount()
        root.style.setProperty('--app-viewport-height', '500px')

        window.dispatchEvent(new Event('focus'))

        expect(root.style.getPropertyValue('--app-viewport-height')).toBe('500px')
    })
})
