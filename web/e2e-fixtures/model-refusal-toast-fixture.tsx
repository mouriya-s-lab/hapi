/*
 * Standalone Vite-served fixture for issue #47. It mounts the production
 * SessionChat with a synthetic Claude `system/model_refusal_fallback` output
 * record and the production ToastProvider/ToastContainer, so the browser smoke
 * covers normalization -> SessionChat toast effect -> warning toast styling.
 * No hub / auth / socket is required.
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
    Outlet,
    RouterProvider,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
} from '@tanstack/react-router'
import '../src/index.css'
import { I18nProvider } from '../src/lib/i18n-context'
import { ToastProvider } from '../src/lib/toast-context'
import { AppContextProvider } from '../src/lib/app-context'
import { ToastContainer } from '../src/components/ToastContainer'
import { SessionChat } from '../src/components/SessionChat'
import type { ApiClient } from '../src/api/client'
import type { DecryptedMessage, Session } from '../src/types/api'

const FALLBACK_MESSAGE = 'Fable 5 safety flagged this message. Switched to Opus 4.8 (1M context).'

function applyFixtureParams(): void {
    const url = new URL(window.location.href)
    const theme = url.searchParams.get('theme')
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark')
    } else {
        document.documentElement.removeAttribute('data-theme')
    }
    localStorage.setItem('hapi-lang', url.searchParams.get('lang') === 'zh-CN' ? 'zh-CN' : 'en')
}

function buildSession(): Session {
    return {
        id: 'model-refusal-session',
        namespace: 'default',
        seq: 1,
        createdAt: 1_742_372_800_000,
        updatedAt: 1_742_372_800_000,
        active: true,
        activeAt: 1_742_372_800_000,
        metadata: {
            path: '/repo/hapi',
            host: 'e2e',
            name: 'Model refusal fallback',
            flavor: 'claude'
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 0,
        model: 'claude-fable-5[1m]',
        modelReasoningEffort: null,
        effort: null,
        resumeWithSessionModel: false
    }
}

function buildMessages(): DecryptedMessage[] {
    return [{
        id: 'msg-model-refusal-fallback',
        seq: 1,
        localId: null,
        createdAt: 1_742_372_800_001,
        content: {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'system',
                    subtype: 'model_refusal_fallback',
                    uuid: 'sys-model-refusal-fallback',
                    direction: 'retry',
                    trigger: 'refusal',
                    originalModel: 'claude-fable-5[1m]',
                    content: FALLBACK_MESSAGE
                }
            }
        }
    }]
}

const api = {} as unknown as ApiClient

const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
})

function FixtureRoot() {
    return (
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <ToastProvider>
                    <AppContextProvider value={{ api, token: 'e2e', baseUrl: 'http://localhost' }}>
                        <Outlet />
                        <ToastContainer />
                    </AppContextProvider>
                </ToastProvider>
            </I18nProvider>
        </QueryClientProvider>
    )
}

function FixtureSession() {
    const session = React.useMemo(() => buildSession(), [])
    const messages = React.useMemo(() => buildMessages(), [])

    return (
        <div data-testid="model-refusal-toast-host" style={{ height: '100vh' }}>
            <SessionChat
                api={api}
                session={session}
                messages={messages}
                messagesWarning={null}
                hasMoreMessages={false}
                isLoadingMessages={false}
                isLoadingMoreMessages={false}
                isSending={false}
                pendingCount={0}
                messagesVersion={1}
                onBack={() => {}}
                onRefresh={() => {}}
                onLoadMore={() => Promise.resolve()}
                onSend={() => Promise.resolve(true)}
                onFlushPending={() => {}}
                onAtBottomChange={() => {}}
            />
        </div>
    )
}

function buildRouter() {
    const rootRoute = createRootRoute({ component: FixtureRoot })
    const sessionsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sessions' })
    const sessionRoute = createRoute({
        getParentRoute: () => sessionsRoute,
        path: '$sessionId',
        component: FixtureSession,
    })
    const routeTree = rootRoute.addChildren([sessionsRoute.addChildren([sessionRoute])])
    const history = createMemoryHistory({ initialEntries: ['/sessions/model-refusal-session'] })
    return createRouter({ routeTree, history }) as unknown as Parameters<typeof RouterProvider>[0]['router']
}

applyFixtureParams()

const rootEl = document.getElementById('root')
if (rootEl) {
    ReactDOM.createRoot(rootEl).render(<RouterProvider router={buildRouter()} />)
}
