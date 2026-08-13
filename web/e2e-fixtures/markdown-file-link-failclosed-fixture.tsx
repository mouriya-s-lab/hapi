/*
 * Visual fixture for #1452 fail-closed markdown file links.
 * Chat-mode MarkdownRenderer (+ HappyChatContext) so FilePathAnchor can paint.
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import '../src/index.css'
import { I18nProvider } from '../src/lib/i18n-context'
import { MarkdownRenderer } from '../src/components/MarkdownRenderer'
import { HappyChatProvider, type HappyChatContextValue } from '../src/components/AssistantChat/context'
import type { ApiClient } from '../src/api/client'

const SAMPLE = `## Fail-closed markdown file links (#1452)

Allowlisted relative (preview): [docs](docs/foo.md)

Absolute in workspace (preview): [abs](/home/ada/coding/hapi/docs/a.md)

Tilde in workspace (preview): [tilde](~/coding/hapi/docs/a.md)

Fragment (preview): [frag](docs/foo.md#section)

Outside workspace (inert, not blue): [etc](/etc/passwd.sh)

No extension (inert): [bare](docs/foo)

Parent escape (inert): [up](../escape.md)

Real app route (SPA): [settings](/settings)

Hash / query (SPA): [hash](#section) · [query](?q=1)
`

function chatValue(): HappyChatContextValue {
    return {
        api: {} as ApiClient,
        sessionId: 'fixture-session',
        metadata: { path: '/home/ada/coding/hapi', host: 'local' },
        terminalToolDisplayMode: 'compact',
        disabled: false,
        onRefresh: () => {},
        hasMoreMessages: false,
        isSyncingTail: false,
        isLoadingMoreMessages: false,
        loadOlderMessagesPreservingScroll: async () => 'loaded',
    }
}

function FixtureBody() {
    return (
        <div data-testid="markdown-file-link-failclosed-fixture">
            <div className="case">
                <h2>Chat surface (HappyChatContext + workspace path)</h2>
                <HappyChatProvider value={chatValue()}>
                    <MarkdownRenderer content={SAMPLE} />
                </HappyChatProvider>
            </div>
        </div>
    )
}

const rootRoute = createRootRoute({ component: FixtureBody })
const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
})

const rootEl = document.getElementById('root')
if (rootEl) {
    ReactDOM.createRoot(rootEl).render(
        <React.StrictMode>
            <I18nProvider>
                <RouterProvider router={router} />
            </I18nProvider>
        </React.StrictMode>
    )
}
