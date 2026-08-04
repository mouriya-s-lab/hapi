/*
 * Standalone Vite-served fixture for the file-viewer Playwright e2e spec
 * (issue #3: markdown preview + word-wrap toggle + mermaid zoom).
 *
 * It mounts the REAL FilePage component behind a minimal in-memory router
 * that mirrors the production route hierarchy (/sessions/$sessionId/file)
 * plus a stubbed AppContext whose api only implements the two methods
 * FilePage calls: getGitDiffFile (no diff) and readSessionFile (returns
 * base64 content chosen by file extension). No hub / auth / socket needed.
 *
 * The target file is chosen via `?file=<path>`:
 *   - a .md path  → markdown sample containing a mermaid block, heading,
 *                   table and an image, so the spec can verify preview,
 *                   mermaid render + zoom, and the preview/raw toggle.
 *   - any other   → a single very long line so the spec can verify the
 *                   word-wrap toggle and its persistence.
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
import { AppContextProvider } from '../src/lib/app-context'
import type { ApiClient } from '../src/api/client'
import type { FileReadResponse, GitCommandResponse } from '../src/types/api'
import FilePage from '../src/routes/sessions/file'
import { encodeBase64 } from '../src/lib/utils'
import { ToastProvider } from '../src/lib/toast-context'

const MARKDOWN_SAMPLE = `# Markdown preview heading

A paragraph with **bold** and \`inline code\` to confirm rendering.

\`\`\`ts
const mobileWrappingProbe = '${'x'.repeat(220)}'
\`\`\`

\`\`\`mermaid
graph TD
  A[Start] --> B{Choice}
  B -->|yes| C[Do thing]
  B -->|no| D[Stop]
\`\`\`

| Col A | Col B |
| ----- | ----- |
| one   | two   |

![remote image](https://example.com/image.png)
`

const LONG_LINE_SAMPLE =
    'this_is_a_single_very_long_line_without_spaces_' +
    'x'.repeat(400) +
    '_end_of_line'

function contentForPath(path: string): string {
    return /\.(md|markdown|mdown|mkd|mkdn|mdwn)$/i.test(path) ? MARKDOWN_SAMPLE : LONG_LINE_SAMPLE
}

const api = {
    async getGitDiffFile(): Promise<GitCommandResponse> {
        // No diff → FilePage falls back to the file view, which is what we test.
        return { success: true, stdout: '', stderr: '' }
    },
    async readSessionFile(_sessionId: string, path: string): Promise<FileReadResponse> {
        return { success: true, content: encodeBase64(contentForPath(path)) }
    },
} as unknown as ApiClient

function getTargetFile(): string {
    const url = new URL(window.location.href)
    return url.searchParams.get('file') ?? 'README.md'
}

function buildRouter(targetFile: string) {
    const rootRoute = createRootRoute({ component: () => <Outlet /> })
    const sessionsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sessions' })
    const sessionDetailRoute = createRoute({ getParentRoute: () => sessionsRoute, path: '$sessionId' })
    const fileRoute = createRoute({
        getParentRoute: () => sessionDetailRoute,
        path: 'file',
        validateSearch: (search: Record<string, unknown>): { path: string; staged?: boolean } => ({
            path: typeof search.path === 'string' ? search.path : '',
        }),
        component: FilePage,
    })

    const routeTree = rootRoute.addChildren([
        sessionsRoute.addChildren([sessionDetailRoute.addChildren([fileRoute])]),
    ])

    const search = new URLSearchParams({ path: encodeBase64(targetFile) }).toString()
    const history = createMemoryHistory({ initialEntries: [`/sessions/e2e/file?${search}`] })

    // The fixture router is intentionally minimal; the loose cast keeps it from
    // having to satisfy the app's registered router type.
    return createRouter({ routeTree, history }) as unknown as Parameters<typeof RouterProvider>[0]['router']
}

const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
})

function App() {
    const targetFile = React.useMemo(() => getTargetFile(), [])
    const router = React.useMemo(() => buildRouter(targetFile), [targetFile])

    return (
        <QueryClientProvider client={queryClient}>
            <ToastProvider>
                <I18nProvider>
                    <AppContextProvider value={{ api, token: 'e2e', baseUrl: 'http://localhost' }}>
                        <div data-testid="file-viewer-host" style={{ height: '100vh' }}>
                            <RouterProvider router={router} />
                        </div>
                    </AppContextProvider>
                </I18nProvider>
            </ToastProvider>
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
