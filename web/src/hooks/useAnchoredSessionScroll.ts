import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

type Anchor = {
    sessionId: string
    /** Captured top offset of the row relative to the scroll container's top. */
    offset: number
    /** Wall-clock ms after which the anchor stops adjusting (so it never fights a later manual scroll). */
    expiresAt: number
}

// Re-anchoring stays active only briefly after a click — long enough to absorb
// the async reorder that opening a session triggers (it becomes active and its
// directory group jumps to the top: SessionList sorts active-first), short
// enough to never interfere with the user's own scrolling afterwards.
const ANCHOR_WINDOW_MS = 900

function rowOffset(container: HTMLElement, sessionId: string): number | null {
    const row = container.querySelector(`[data-session-id="${CSS.escape(sessionId)}"]`)
    if (!row) return null
    return row.getBoundingClientRect().top - container.getBoundingClientRect().top
}

/**
 * Keep the clicked session row visually anchored across the list reorder that
 * selecting it triggers. Without this, clicking a session resumes it → it goes
 * active → its group is re-sorted to the top of the list, so the scroll position
 * lurches to "a weird place" (see e2e/session-scroll.spec.ts).
 *
 * Capture the row's viewport offset at click time, then restore that offset on
 * each subsequent commit within a short window — including the delayed commit
 * where the activation actually lands.
 */
export function useAnchoredSessionScroll(
    containerRef: RefObject<HTMLElement | null>,
    now: () => number = () => Date.now(),
): (sessionId: string) => void {
    const anchorRef = useRef<Anchor | null>(null)

    const captureAnchor = useCallback((sessionId: string) => {
        const container = containerRef.current
        if (!container) return
        const offset = rowOffset(container, sessionId)
        if (offset === null) return
        anchorRef.current = { sessionId, offset, expiresAt: now() + ANCHOR_WINDOW_MS }
    }, [containerRef, now])

    // Cancel the anchor the moment the user scrolls themselves — programmatic
    // scrollTop writes don't emit these intent events, so this never self-cancels.
    useEffect(() => {
        const container = containerRef.current
        if (!container) return undefined
        const cancel = () => { anchorRef.current = null }
        const opts = { passive: true } as const
        container.addEventListener('wheel', cancel, opts)
        container.addEventListener('touchmove', cancel, opts)
        container.addEventListener('keydown', cancel)
        return () => {
            container.removeEventListener('wheel', cancel)
            container.removeEventListener('touchmove', cancel)
            container.removeEventListener('keydown', cancel)
        }
    }, [containerRef])

    useLayoutEffect(() => {
        const anchor = anchorRef.current
        const container = containerRef.current
        if (!anchor || !container) return
        if (now() >= anchor.expiresAt) {
            anchorRef.current = null
            return
        }
        const current = rowOffset(container, anchor.sessionId)
        if (current === null) return
        const delta = current - anchor.offset
        if (Math.abs(delta) > 1) {
            container.scrollTop += delta
        }
    })

    return captureAnchor
}
