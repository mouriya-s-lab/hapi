/*
 * Standalone Vite-served fixture for the bob-fork-customizations Playwright
 * spec. It exercises the three UI-observable pieces of the import from
 * bobmcmxciv/hapi@1a6684d5 in isolation, behind a minimal provider set (no
 * hub / auth / socket):
 *
 *   1. Read tool result view — inline image preview when the base64 payload
 *      matches an image magic prefix. Uses the real
 *      `getToolResultViewComponent('Read')` component so the spec sees the
 *      exact wiring chat renders.
 *
 *   2. Chat markdown — data:image/* URLs are no longer stripped by
 *      denyOnlyTransform, so <img> elements survive the URL transform.
 *
 *   3. Chat markdown — remark-file-path-links now links absolute POSIX
 *      paths, home-relative paths, and Windows drive-absolute paths (was
 *      previously refused). Extension whitelist also gained pdf/log/xlsx
 *      etc.; the fixture uses one of each to sanity-check.
 *
 * The three sections mount independently so a single spec can walk them
 * with distinct testids.
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import ReactMarkdown from 'react-markdown'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../src/index.css'
import { I18nProvider } from '../src/lib/i18n-context'
import { AppContextProvider } from '../src/lib/app-context'
import type { ApiClient } from '../src/api/client'
import type { ToolCallBlock } from '../src/chat/types'
import { getToolResultViewComponent } from '../src/components/ToolCard/views/_results'
// Chat's MarkdownRenderer relies on `@assistant-ui/react-markdown`'s
// MarkdownTextPrimitive, which reads a `message` scope via useSmooth and
// throws when mounted outside a rendered chat thread. The fixture instead
// wires react-markdown directly with the same MARKDOWN_PLUGINS chain and the
// fork's denyOnlyTransform — this exercises exactly the two touched pieces
// (remarkFilePathLinks + denyOnlyTransform) without dragging in the thread
// scope requirement. See fork-features/trunk-patches.md notes.
import { MARKDOWN_PLUGINS, denyOnlyTransform } from '../src/components/assistant-ui/markdown-text'

// Minimal PNG (1×1 transparent) base64. Detection only inspects the leading
// magic bytes `iVBORw0KGgo`; padding to > 64 chars clears the min-length gate.
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAA0lEQVR42mNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII='

function buildReadImageBlock(): ToolCallBlock {
    return {
        id: 'tool-read-image',
        localId: null,
        createdAt: 0,
        kind: 'tool-call',
        children: [],
        tool: {
            id: 'tool-read-image',
            name: 'Read',
            state: 'completed',
            input: { file_path: '/tmp/pixel.png' },
            // Real chat surface: Read hands back either a `{ file: {...} }`
            // envelope or the raw text; the base64 blob returned as a plain
            // string covers the more common path.
            result: PNG_BASE64,
            createdAt: 0,
            startedAt: null,
            completedAt: 0,
            description: null,
        },
    }
}

const MARKDOWN_WITH_DATA_IMAGE = `Inline preview:

![tiny pixel](data:image/png;base64,${PNG_BASE64})

end.`

// One absolute POSIX path (recognized extension), one home-relative, one
// Windows drive path with backslashes, and one bare relative for the previous
// baseline. Also mix in a URL that must NOT get rewritten.
const MARKDOWN_WITH_PATHS = `Look at /Users/dev/project/report.pdf and ~/notes.md and C:\\logs\\build.log and cli/src/main.ts:12.

Docs: https://example.com/assets/logo.png (should stay a plain link, not a file link).`

const api = {} as unknown as ApiClient
const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
})

function App() {
    const ResultView = getToolResultViewComponent('Read')
    const readImageBlock = React.useMemo(() => buildReadImageBlock(), [])

    return (
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <AppContextProvider value={{ api, token: 'e2e', baseUrl: 'http://localhost' }}>
                    <section data-testid="section-read-image">
                        <h2>1. Read tool → base64 image → inline preview</h2>
                        {ResultView ? (
                            <ResultView block={readImageBlock} metadata={null} surface="inline" />
                        ) : (
                            <div>ResultView missing</div>
                        )}
                    </section>

                    <section data-testid="section-markdown-data-image">
                        <h2>2. Markdown allows data:image/* URLs</h2>
                        <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS} urlTransform={denyOnlyTransform}>
                            {MARKDOWN_WITH_DATA_IMAGE}
                        </ReactMarkdown>
                    </section>

                    <section data-testid="section-markdown-paths">
                        <h2>3. Markdown links absolute + Windows + home-relative paths</h2>
                        <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS} urlTransform={denyOnlyTransform}>
                            {MARKDOWN_WITH_PATHS}
                        </ReactMarkdown>
                    </section>
                </AppContextProvider>
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
