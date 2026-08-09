import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

// TanStack Router scroll restoration tracks every scrollable element, including
// the persistent session sidebar, and restores its scrollTop per pathname. A
// session navigation can therefore replace the user's current sidebar position
// with a stale value recorded for the destination route.
const NAV_RESTORE_WINDOW_MS = 400

export function usePreserveSidebarScroll(
    container: HTMLElement | null,
    pathname: string,
): void {
    const savedTopRef = useRef(0)
    const navAtRef = useRef(0)

    useEffect(() => {
        if (!container) return undefined
        const onScroll = () => {
            if (Date.now() - navAtRef.current > NAV_RESTORE_WINDOW_MS) {
                savedTopRef.current = container.scrollTop
            }
        }
        container.addEventListener('scroll', onScroll, { passive: true })
        return () => container.removeEventListener('scroll', onScroll)
    }, [container])

    useEffect(() => {
        if (!container) return undefined
        navAtRef.current = Date.now()
        let raf2 = 0
        const raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => {
                if (Math.abs(container.scrollTop - savedTopRef.current) > 1) {
                    container.scrollTop = savedTopRef.current
                }
            })
        })
        return () => {
            cancelAnimationFrame(raf1)
            cancelAnimationFrame(raf2)
        }
    }, [container, pathname])
}

type Anchor = {
    sessionId: string
    offset: number
    expiresAt: number
}

const ANCHOR_WINDOW_MS = 900

function rowOffset(container: HTMLElement, sessionId: string): number | null {
    const row = container.querySelector(`[data-session-id="${CSS.escape(sessionId)}"]`)
    if (!row) return null
    return row.getBoundingClientRect().top - container.getBoundingClientRect().top
}

/**
 * Keep the selected session row at the same viewport offset while opening the
 * session changes its active state and reorders its directory group.
 */
export function useAnchoredSessionScroll(
    container: HTMLElement | null,
): (sessionId: string) => void {
    const anchorRef = useRef<Anchor | null>(null)
    const detachRef = useRef<(() => void) | null>(null)

    const clearAnchor = useCallback(() => {
        anchorRef.current = null
        detachRef.current?.()
        detachRef.current = null
    }, [])

    useEffect(() => clearAnchor, [clearAnchor])

    const captureAnchor = useCallback((sessionId: string) => {
        clearAnchor()
        if (!container) return
        const offset = rowOffset(container, sessionId)
        if (offset === null) return

        anchorRef.current = {
            sessionId,
            offset,
            expiresAt: Date.now() + ANCHOR_WINDOW_MS,
        }
        const cancel = () => clearAnchor()
        const passive = { passive: true } as const
        container.addEventListener('wheel', cancel, passive)
        container.addEventListener('touchmove', cancel, passive)
        container.addEventListener('pointerdown', cancel, passive)
        container.addEventListener('keydown', cancel)
        detachRef.current = () => {
            container.removeEventListener('wheel', cancel)
            container.removeEventListener('touchmove', cancel)
            container.removeEventListener('pointerdown', cancel)
            container.removeEventListener('keydown', cancel)
        }
    }, [clearAnchor, container])

    useLayoutEffect(() => {
        const anchor = anchorRef.current
        if (!anchor || !container) return
        if (Date.now() >= anchor.expiresAt) {
            clearAnchor()
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
