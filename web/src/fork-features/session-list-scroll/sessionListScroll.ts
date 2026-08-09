import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SessionListScrollStability } from '@/components/SessionList'
export const DISABLED_SESSION_LIST_SCROLL_STABILITY: SessionListScrollStability = {
    container: null,
    bindContainer: () => {},
    beforeSelect: () => {},
}

// TanStack Router scroll restoration tracks every scrollable element, including
// the persistent session sidebar, and restores its scrollTop per pathname. A
// session navigation can therefore replace the user's current sidebar position
// with a stale value recorded for the destination route.
const NAV_RESTORE_WINDOW_MS = 400
const ANCHOR_WINDOW_MS = 900

type Anchor = {
    sessionId: string
    offset: number
    expiresAt: number
}

export type SessionListScrollStabilityMode =
    | 'all'
    | 'preserve-only'
    | 'anchor-only'
    | 'off'

function guardCapabilities(mode: SessionListScrollStabilityMode): {
    preserve: boolean
    anchor: boolean
} {
    switch (mode) {
        case 'all':
            return { preserve: true, anchor: true }
        case 'preserve-only':
            return { preserve: true, anchor: false }
        case 'anchor-only':
            return { preserve: false, anchor: true }
        case 'off':
            return { preserve: false, anchor: false }
    }
}

function rowOffset(container: HTMLElement, sessionId: string): number | null {
    const row = container.querySelector(`[data-session-id="${CSS.escape(sessionId)}"]`)
    if (!row) return null
    return row.getBoundingClientRect().top - container.getBoundingClientRect().top
}

/**
 * Coordinates Router restoration and active-first reordering around one desired
 * sidebar position. SessionList consumes both callbacks as one required binding
 * so its real scroll node and pre-navigation selection cannot drift apart.
 */
export function useSessionListScrollStability(
    pathname: string,
    mode: SessionListScrollStabilityMode = 'all',
): SessionListScrollStability {
    const [container, bindContainer] = useState<HTMLDivElement | null>(null)
    const desiredTopRef = useRef(0)
    const navigationAtRef = useRef(0)
    const firstRestoreFrameRef = useRef<number | null>(null)
    const secondRestoreFrameRef = useRef<number | null>(null)
    const anchorRef = useRef<Anchor | null>(null)
    const { preserve, anchor } = guardCapabilities(mode)

    const clearAnchor = useCallback(() => {
        anchorRef.current = null
    }, [])

    const cancelPendingRestore = useCallback(() => {
        if (firstRestoreFrameRef.current !== null) {
            cancelAnimationFrame(firstRestoreFrameRef.current)
            firstRestoreFrameRef.current = null
        }
        if (secondRestoreFrameRef.current !== null) {
            cancelAnimationFrame(secondRestoreFrameRef.current)
            secondRestoreFrameRef.current = null
        }
    }, [])

    useEffect(() => () => {
        clearAnchor()
        cancelPendingRestore()
    }, [cancelPendingRestore, clearAnchor])

    useEffect(() => {
        if (!container || !preserve) return undefined
        const recordDesiredTop = () => {
            if (Date.now() - navigationAtRef.current > NAV_RESTORE_WINDOW_MS) {
                desiredTopRef.current = container.scrollTop
            }
        }
        container.addEventListener('scroll', recordDesiredTop, { passive: true })
        return () => container.removeEventListener('scroll', recordDesiredTop)
    }, [container, preserve])

    useEffect(() => {
        if (!container || (!preserve && !anchor)) return undefined
        const acceptUserInput = () => {
            clearAnchor()
            if (preserve) {
                cancelPendingRestore()
                navigationAtRef.current = 0
            }
        }
        const passive = { passive: true } as const
        container.addEventListener('wheel', acceptUserInput, passive)
        container.addEventListener('touchmove', acceptUserInput, passive)
        container.addEventListener('pointerdown', acceptUserInput, passive)
        container.addEventListener('keydown', acceptUserInput)
        return () => {
            container.removeEventListener('wheel', acceptUserInput)
            container.removeEventListener('touchmove', acceptUserInput)
            container.removeEventListener('pointerdown', acceptUserInput)
            container.removeEventListener('keydown', acceptUserInput)
        }
    }, [anchor, cancelPendingRestore, clearAnchor, container, preserve])

    useLayoutEffect(() => {
        if (!container || !preserve) return undefined
        navigationAtRef.current = Date.now()
        cancelPendingRestore()
        firstRestoreFrameRef.current = requestAnimationFrame(() => {
            firstRestoreFrameRef.current = null
            secondRestoreFrameRef.current = requestAnimationFrame(() => {
                secondRestoreFrameRef.current = null
                if (Math.abs(container.scrollTop - desiredTopRef.current) > 1) {
                    container.scrollTop = desiredTopRef.current
                }
            })
        })
        return cancelPendingRestore
    }, [cancelPendingRestore, container, pathname, preserve])

    const beforeSelect = useCallback((sessionId: string) => {
        clearAnchor()
        if (!anchor || !container) return
        const offset = rowOffset(container, sessionId)
        if (offset === null) return
        anchorRef.current = {
            sessionId,
            offset,
            expiresAt: Date.now() + ANCHOR_WINDOW_MS,
        }
    }, [anchor, clearAnchor, container])

    useLayoutEffect(() => {
        const captured = anchorRef.current
        if (!captured || !container) return
        if (Date.now() >= captured.expiresAt) {
            clearAnchor()
            return
        }
        const current = rowOffset(container, captured.sessionId)
        if (current === null) return
        const delta = current - captured.offset
        if (Math.abs(delta) <= 1) return
        container.scrollTop += delta
        if (preserve) {
            desiredTopRef.current = container.scrollTop
        }
    })

    return useMemo(() => ({
        container,
        bindContainer,
        beforeSelect,
    }), [beforeSelect, container])
}
