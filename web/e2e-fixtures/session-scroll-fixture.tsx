/*
 * Fixture for the "session list jumps to a weird scroll position on click" bug.
 *
 * Mirrors router.tsx's sidebar wiring: the REAL SessionList inside a fixed-height
 * `.app-scroll-y` container, driven by a `selectedSessionId` state that updates on
 * select (exactly what navigate(/sessions/$id) does to the prop). Enough sessions
 * across several directory groups to overflow and scroll. Playwright's trusted
 * clicks fire SessionList's useLongPress onClick (synthetic .click() does not),
 * so this reproduces the real selection-driven layout shift.
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../src/index.css'
import { I18nProvider } from '../src/lib/i18n-context'
import { SessionList } from '../src/components/SessionList'
import { useAnchoredSessionScroll } from '../src/hooks/useAnchoredSessionScroll'
import type { SessionSummary } from '../src/types/api'

function summary(over: Partial<SessionSummary> & { id: string; name: string; path: string; machineId: string }): SessionSummary {
    const { name, path, machineId, ...rest } = over
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
    } as SessionSummary
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
for (const g of groups) {
    const tag = g.dir.split('/').pop()
    for (let i = 0; i < 6; i++) {
        SESSIONS.push(summary({
            id: `${tag}-${i}`,
            name: `${tag} session ${i}`,
            path: g.dir,
            machineId: 'machine-1',
            active: g.active,
            updatedAt: 1_000_000 - SESSIONS.length,
        }))
    }
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })

function App() {
    const initialSel = new URLSearchParams(location.search).get('sel')
    const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(initialSel)
    // Mirror the real app: opening a session resumes it, so it (and thus its
    // directory group) becomes active shortly after the click. `?activate=0`
    // disables this to compare behaviour.
    const activateOnSelect = !new URLSearchParams(location.search).has('noactivate')
    const [activeId, setActiveId] = React.useState<string | null>(null)
    const sessions = React.useMemo(
        () => activateOnSelect && activeId
            ? SESSIONS.map((s) => s.id === activeId ? { ...s, active: true } : s)
            : SESSIONS,
        [activeId, activateOnSelect],
    )
    // `?noanchor` disables the fix so the spec can prove the bug still reproduces
    // without it; the default path exercises the real anchoring hook (as router.tsx wires it).
    const anchorEnabled = !new URLSearchParams(location.search).has('noanchor')
    const scrollRef = React.useRef<HTMLDivElement>(null)
    const captureAnchor = useAnchoredSessionScroll(scrollRef)
    return (
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <div style={{ height: 420, width: 360, border: '1px solid #ccc' }} className="flex flex-col">
                    <div data-testid="selected-readout" style={{ font: '12px monospace', padding: 4 }}>
                        selected: {selectedSessionId ?? 'none'}
                    </div>
                    <div ref={scrollRef} className="app-scroll-y flex-1 min-h-0" data-testid="session-scroll-container">
                        <SessionList
                            sessions={sessions}
                            selectedSessionId={selectedSessionId}
                            onSelect={(id) => { if (anchorEnabled) captureAnchor(id); setSelectedSessionId(id); setActiveId(id) }}
                            onNewSession={() => {}}
                            onRefresh={() => {}}
                            isLoading={false}
                            renderHeader={false}
                            api={null}
                        />
                    </div>
                </div>
            </I18nProvider>
        </QueryClientProvider>
    )
}

const rootEl = document.getElementById('root')
if (rootEl) {
    ReactDOM.createRoot(rootEl).render(<App />)
}
