/*
 * Fixture for the "session list jumps to a weird scroll position on click" bug
 * (issue #31 / #277).
 *
 * Uses the same required stability binding as router.tsx. The REAL SessionList
 * reports its internal scroll node through the binding and invokes its
 * pre-navigation selection callback before the fixture mirrors route changes.
 * Enough directory groups overflow the real list and trigger active-first
 * reordering.
 *
 * Query params:
 *   sel=<id>       initial selected session
 *   noanchor       disable row anchoring
 *   nopreserve     disable router-restoration rejection
 *   noactivate     selection does not activate the session
 *   fastactivate   activation lands inside the restoration window
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../src/index.css'
import { I18nProvider } from '../src/lib/i18n-context'
import { SessionList } from '../src/components/SessionList'
import {
    useSessionListScrollStability,
    type SessionListScrollStabilityMode,
} from '../src/fork-features/session-list-scroll/sessionListScroll'
import type { SessionSummary } from '../src/types/api'

function summary(
    overrides: Partial<SessionSummary> & { id: string; name: string; path: string; machineId: string },
): SessionSummary {
    const { name, path, machineId, ...rest } = overrides
    return {
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        model: null,
        effort: null,
        ...rest,
        metadata: { path, machineId, name, ...(rest.metadata ?? {}) },
    }
}

// One machine, several directory groups. The first two are active (sorted to the
// top, always expanded); the rest are inactive (collapsed headers). `delta` is the
// deepest inactive group. Opening one of its sessions activates it, so it jumps up
// into the active region past every collapsed inactive group above it — the reorder
// that makes the list "scroll to a weird place". Active groups above delta leave
// room for the anchor fix to restore the clicked row's position.
const SESSIONS: SessionSummary[] = []
const groups = [
    { dir: '/proj/alpha', active: true },
    { dir: '/proj/bravo', active: true },
    { dir: '/proj/charlie', active: false },
    { dir: '/proj/echo', active: false },
    { dir: '/proj/foxtrot', active: false },
    { dir: '/proj/golf', active: false },
    { dir: '/proj/delta', active: false },
]
for (const group of groups) {
    const tag = group.dir.split('/').pop()
    for (let index = 0; index < 6; index++) {
        SESSIONS.push(summary({
            id: `${tag}-${index}`,
            name: `${tag} session ${index}`,
            path: group.dir,
            machineId: 'machine-1',
            active: group.active,
            updatedAt: 1_000_000 - SESSIONS.length,
        }))
    }
}

// Opening a session resumes it and the active flag lands later via SSE. The
// fast variant exercises activation inside the Router restoration window.
const DEFAULT_ACTIVATION_DELAY_MS = 500

const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
})

function scrollStabilityMode(
    preserveEnabled: boolean,
    anchorEnabled: boolean,
): SessionListScrollStabilityMode {
    if (preserveEnabled && anchorEnabled) return 'all'
    if (preserveEnabled) return 'preserve-only'
    if (anchorEnabled) return 'anchor-only'
    return 'off'
}

function App() {
    const params = new URLSearchParams(location.search)
    const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(params.get('sel'))
    const activateOnSelect = !params.has('noactivate')
    const anchorEnabled = !params.has('noanchor')
    const preserveEnabled = !params.has('nopreserve')
    const [activeId, setActiveId] = React.useState<string | null>(null)
    const sessions = React.useMemo(() => {
        if (!activateOnSelect || !activeId) return SESSIONS
        return SESSIONS.map((session) => (
            session.id === activeId ? { ...session, active: true } : session
        ))
    }, [activeId, activateOnSelect])
    const pathname = preserveEnabled ? `/sessions/${selectedSessionId ?? 'none'}` : '/static'
    const scrollStability = useSessionListScrollStability(
        pathname,
        scrollStabilityMode(preserveEnabled, anchorEnabled),
    )
    const scrollContainer = scrollStability.container
    // Expose the real internal scroll container and a semantic readiness signal
    // to Playwright. This timer deliberately crosses the production guard's
    // 400ms wall-clock window; the spec waits on the signal, not a guessed delay.
    React.useEffect(() => {
        if (!scrollContainer) return undefined
        scrollContainer.setAttribute('data-testid', 'session-scroll-container')
        const readyTimer = window.setTimeout(() => {
            scrollContainer.setAttribute('data-preserve-ready', 'true')
        }, 450)
        return () => window.clearTimeout(readyTimer)
    }, [scrollContainer])
    React.useEffect(() => {
        scrollContainer?.setAttribute('data-active-session-id', activeId ?? '')
    }, [activeId, scrollContainer])
    // Simulate TanStack Router's per-route scroll restoration: right after a
    // navigation it rewrites the tracked container's scrollTop from the target
    // route's bucket (a stale value — here 0). One rAF puts the write between
    // the preserve hook's nav timestamp and its double-rAF re-assert, matching
    // the real ordering (restoration fires in onRendered, re-assert after).
    const simulateRestoration = React.useCallback(() => {
        scrollContainer?.removeAttribute('data-restoration-written')
        requestAnimationFrame(() => {
            if (!scrollContainer) return
            scrollContainer.scrollTop = 0
            scrollContainer.setAttribute('data-restoration-written', 'true')
        })
    }, [scrollContainer])
    return (
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <div style={{ height: 420, width: 360, border: '1px solid #ccc' }} className="flex flex-col">
                    <div
                        data-testid="selected-readout"
                        data-selected-session-id={selectedSessionId ?? ''}
                        style={{ font: '12px monospace', padding: 4 }}
                    >
                        selected: {selectedSessionId ?? 'none'}
                    </div>
                    <SessionList
                        sessions={sessions}
                        selectedSessionId={selectedSessionId}
                        scrollStability={scrollStability}
                        onSelect={(id) => {
                            setSelectedSessionId(id)
                            simulateRestoration()
                            if (activateOnSelect) {
                                const delay = params.has('fastactivate') ? 0 : DEFAULT_ACTIVATION_DELAY_MS
                                setTimeout(() => setActiveId(id), delay)
                            }
                        }}
                        onNewSession={() => {}}
                        onRefresh={() => {}}
                        isLoading={false}
                        renderHeader={false}
                        api={null}
                    />
                </div>
            </I18nProvider>
        </QueryClientProvider>
    )
}

const rootEl = document.getElementById('root')
if (rootEl) {
    ReactDOM.createRoot(rootEl).render(<App />)
}
