import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useLongPress } from './useLongPress'

function Probe(props: { onClick: () => void; onLongPress?: () => void }) {
    const handlers = useLongPress({
        onClick: props.onClick,
        onLongPress: props.onLongPress ?? (() => {}),
    })
    return (
        <button type="button" data-testid="row" {...handlers}>
            row
        </button>
    )
}

describe('useLongPress', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        // Start well past the ghost-mouse window so a plain mouse tap (no prior
        // touch, lastTouchAt = 0) is not mistaken for a touch-synthesized event.
        vi.setSystemTime(10_000)
    })

    afterEach(() => {
        cleanup()
        vi.useRealTimers()
    })

    it('fires onClick once for a mouse tap', () => {
        const onClick = vi.fn()
        const { getByTestId } = render(<Probe onClick={onClick} />)
        const row = getByTestId('row')

        fireEvent.mouseDown(row, { button: 0, clientX: 10, clientY: 10 })
        fireEvent.mouseUp(row, { button: 0, clientX: 10, clientY: 10 })

        expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('fires onClick once for a touch tap (ignores the browser-synthesized mouse events that follow)', () => {
        // Real touch browsers (Android Chrome, etc.) emit a compatibility
        // mousedown/mouseup/click ~300ms after touchend for any touch the page
        // did not preventDefault. Because useLongPress binds BOTH touch and
        // mouse handlers, those synthesized events must not trigger a second
        // onClick — otherwise a tap navigates twice (and the second navigation
        // lands on whatever row slid under the finger meanwhile).
        const onClick = vi.fn()
        const { getByTestId } = render(<Probe onClick={onClick} />)
        const row = getByTestId('row')

        fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] })
        fireEvent.touchEnd(row, { changedTouches: [{ clientX: 10, clientY: 10 }] })

        // Browser-synthesized compatibility mouse events for the same tap,
        // ~300ms later.
        act(() => {
            vi.advanceTimersByTime(300)
        })
        fireEvent.mouseDown(row, { button: 0, clientX: 10, clientY: 10 })
        fireEvent.mouseUp(row, { button: 0, clientX: 10, clientY: 10 })

        expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('still fires onLongPress (and not onClick) for a touch long-press', () => {
        const onClick = vi.fn()
        const onLongPress = vi.fn()
        const { getByTestId } = render(<Probe onClick={onClick} onLongPress={onLongPress} />)
        const row = getByTestId('row')

        fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] })
        act(() => {
            vi.advanceTimersByTime(500)
        })
        fireEvent.touchEnd(row, { changedTouches: [{ clientX: 10, clientY: 10 }] })

        expect(onLongPress).toHaveBeenCalledTimes(1)
        expect(onClick).not.toHaveBeenCalled()
    })

    it('still honors a genuine mouse click well after a touch', () => {
        const onClick = vi.fn()
        const { getByTestId } = render(<Probe onClick={onClick} />)
        const row = getByTestId('row')

        // A touch interaction happens first.
        fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] })
        fireEvent.touchEnd(row, { changedTouches: [{ clientX: 10, clientY: 10 }] })
        expect(onClick).toHaveBeenCalledTimes(1)

        // Much later, a real mouse interaction must still work (hybrid devices).
        act(() => {
            vi.advanceTimersByTime(1_000)
        })
        fireEvent.mouseDown(row, { button: 0, clientX: 10, clientY: 10 })
        fireEvent.mouseUp(row, { button: 0, clientX: 10, clientY: 10 })

        expect(onClick).toHaveBeenCalledTimes(2)
    })
})
