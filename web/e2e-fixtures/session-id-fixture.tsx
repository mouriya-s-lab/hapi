/*
 * Standalone Vite-served fixture for the conversation-header "Session ID"
 * Playwright spec (issue #20: 三点菜单加「Session ID」项,弹出可 resume 的
 * session id 到只读 input + 一键复制).
 *
 * Mounts the REAL SessionHeader (the conversation top bar that renders the
 * 3-dot SessionActionMenu and the fork's SessionIdDialog) for a synthetic
 * session, behind the same minimal provider set as the other fixtures. No
 * hub / auth / socket — api is null, which SessionHeader/useSessionActions
 * tolerate (the mutations simply don't fire; the session-id surface needs none).
 *
 * Query params:
 *   - ?flavor=<flavor>  (default omp)   — drives which *SessionId metadata field
 *                                          resolveAgentSessionIdFromMetadata reads.
 *   - ?sid=<id>         (default omp-thread-e2e) — the resume id; pass empty to
 *                                          exercise the empty-state path.
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../src/index.css'
import { I18nProvider } from '../src/lib/i18n-context'
import { ToastProvider } from '../src/lib/toast-context'
import { AppContextProvider } from '../src/lib/app-context'
import type { ApiClient } from '../src/api/client'
import type { Session } from '../src/types/api'
import { SessionHeader } from '../src/components/SessionHeader'

function getParams(): { flavor: string; sid: string } {
    const url = new URL(window.location.href)
    return {
        flavor: url.searchParams.get('flavor') ?? 'omp',
        sid: url.searchParams.get('sid') ?? 'omp-thread-e2e',
    }
}

function buildSession(flavor: string, sid: string): Session {
    const idFieldByFlavor: Record<string, string> = {
        omp: 'ompSessionId',
        opencode: 'opencodeSessionId',
        codex: 'codexSessionId',
        gemini: 'geminiSessionId',
        cursor: 'cursorSessionId',
        kimi: 'kimiSessionId',
        claude: 'claudeSessionId',
    }
    const field = idFieldByFlavor[flavor] ?? 'claudeSessionId'
    const metadata: Record<string, unknown> = {
        path: '/tmp/project',
        host: 'localhost',
        flavor,
        name: 'E2E session',
    }
    if (sid) {
        metadata[field] = sid
    }
    return {
        id: 'session-e2e',
        active: true,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata,
    } as Session
}

const api = {} as unknown as ApiClient

const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
})

function App() {
    const { flavor, sid } = React.useMemo(() => getParams(), [])
    const session = React.useMemo(() => buildSession(flavor, sid), [flavor, sid])

    return (
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <ToastProvider>
                    <AppContextProvider value={{ api, token: 'e2e', baseUrl: 'http://localhost' }}>
                        <div data-testid="session-id-host">
                            <SessionHeader
                                session={session}
                                onBack={() => {}}
                                api={null}
                            />
                        </div>
                    </AppContextProvider>
                </ToastProvider>
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
