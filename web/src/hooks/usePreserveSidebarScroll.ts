import { useEffect, useRef, type RefObject } from 'react'

// TanStack Router scroll restoration (router.tsx `scrollRestoration: true`)
// tracks EVERY scrollable element — including the persistent session sidebar —
// and restores its scrollTop per pathname on navigation. So clicking a session
// makes the sidebar jump to whatever scroll was last recorded for that route
// instead of staying where the user is (issue #31). TanStack exposes no
// per-element opt-out, so we re-assert the user's sidebar scroll position after
// each navigation, keeping the persistent sidebar put.

// Window after a navigation during which sidebar scroll events are treated as
// Router's restoration write (and ignored) rather than user input. The only
// programmatic scroll of this sidebar is Router's restoration, which fires
// right after navigation; everything else is the user (wheel / touch / keyboard
// / scrollbar drag), so a time gate captures all user scroll methods.
const NAV_RESTORE_WINDOW_MS = 400

export function usePreserveSidebarScroll(
    containerRef: RefObject<HTMLElement | null>,
    pathname: string,
): void {
    const savedTopRef = useRef(0)
    const navAtRef = useRef(0)

    // Record the user's intended scroll position from any scroll, except within
    // the post-navigation window where Router restores the tracked scrollTop.
    useEffect(() => {
        const el = containerRef.current
        if (!el) return undefined
        const onScroll = () => {
            if (Date.now() - navAtRef.current > NAV_RESTORE_WINDOW_MS) {
                savedTopRef.current = el.scrollTop
            }
        }
        el.addEventListener('scroll', onScroll, { passive: true })
        return () => el.removeEventListener('scroll', onScroll)
    }, [containerRef])

    // After each navigation, re-assert the saved sidebar position over Router's
    // per-route restoration, which runs around the same commit. Two rAFs push
    // past the restoration write.
    useEffect(() => {
        const el = containerRef.current
        if (!el) return undefined
        navAtRef.current = Date.now()
        let raf2 = 0
        const raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => {
                if (Math.abs(el.scrollTop - savedTopRef.current) > 1) {
                    el.scrollTop = savedTopRef.current
                }
            })
        })
        return () => {
            cancelAnimationFrame(raf1)
            cancelAnimationFrame(raf2)
        }
    }, [pathname, containerRef])
}
