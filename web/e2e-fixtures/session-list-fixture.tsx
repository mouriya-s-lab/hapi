/*
 * Standalone Vite-served fixture for the session-list Playwright e2e spec
 * (issue #4: "ready" blue dot + hide-archived toggle).
 *
 * Mounts the REAL SessionList with crafted SessionSummary data inside an
 * I18nProvider, plus a real hide-archived toggle wired through the production
 * useHideArchivedSessions hook and filterVisibleSessions helper — mirroring how
 * router.tsx filters the list. No hub / auth / socket needed.
 *
 * Detailed session-list status mode is forced on so the attention dots render
 * (SessionList only classifies attention in detailed mode).
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../src/index.css'
import { I18nProvider } from '../src/lib/i18n-context'
import { SessionList } from '../src/components/SessionList'
import { useHideArchivedSessions } from '../src/hooks/useHideArchivedSessions'
import { filterVisibleSessions } from '../src/lib/sessionListFilters'
import type { SessionSummary } from '../src/types/api'

// Force detailed status mode so attention dots are classified + rendered.
try {
    localStorage.setItem('hapi-session-list-status-mode', 'detailed')
} catch {
    // ignore
}

function summary(overrides: Partial<SessionSummary> & { id: string; name: string }): SessionSummary {
    const { name, ...rest } = overrides
    return {
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: { path: '/proj/demo', name },
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        model: null,
        effort: null,
        ...rest,
        metadata: { path: '/proj/demo', name, ...(rest.metadata ?? {}) },
    }
}

const SESSIONS: SessionSummary[] = [
    summary({ id: 'ready-1', name: 'Ready Session', active: true, thinking: false }),
    summary({ id: 'thinking-1', name: 'Thinking Session', active: true, thinking: true }),
    summary({ id: 'archived-1', name: 'Archived Session', active: false, metadata: { path: '/proj/demo', name: 'Archived Session', archivedAt: 111 } }),
]

const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
})

function App() {
    const { hideArchivedSessions, setHideArchivedSessions } = useHideArchivedSessions()
    const visible = filterVisibleSessions(SESSIONS, hideArchivedSessions)

    return (
        <QueryClientProvider client={queryClient}>
        <I18nProvider>
            <div style={{ maxWidth: 480, margin: '0 auto' }}>
                <button
                    type="button"
                    data-testid="hide-archived-toggle"
                    aria-pressed={hideArchivedSessions}
                    onClick={() => setHideArchivedSessions(!hideArchivedSessions)}
                >
                    toggle hide archived
                </button>
                <div data-testid="session-list-host">
                    <SessionList
                        sessions={visible}
                        onSelect={() => {}}
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
    ReactDOM.createRoot(rootEl).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    )
}
