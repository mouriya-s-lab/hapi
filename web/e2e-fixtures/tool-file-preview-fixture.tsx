/*
 * Standalone Vite-served fixture for the tool-card file-preview Playwright spec
 * (follow-up to issue #3: bring the markdown-preview + word-wrap toggles to the
 * "click a file in chat → popup preview" surface).
 *
 * The popup is the tool detail dialog; its file content is produced by the Read
 * tool's result view at `surface="dialog"`, which routes into the fork's
 * FileContentToggleView. This fixture mounts that REAL result view (the exact
 * component the dialog renders) for a synthetic Read tool call, behind the same
 * minimal provider set as the file-viewer fixture. No hub / auth / socket.
 *
 * The target file is chosen via `?file=<path>`:
 *   - a .md path  → markdown sample (heading + mermaid + table) so the spec can
 *                   verify the preview/raw toggle and rendered markdown.
 *   - any other   → a single very long line so the spec can verify the
 *                   word-wrap toggle and its persistence.
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../src/index.css'
import { I18nProvider } from '../src/lib/i18n-context'
import { AppContextProvider } from '../src/lib/app-context'
import type { ApiClient } from '../src/api/client'
import type { ToolCallBlock } from '../src/chat/types'
import { getToolResultViewComponent } from '../src/components/ToolCard/views/_results'

const MARKDOWN_SAMPLE = `# Markdown preview heading

A paragraph with **bold** and \`inline code\` to confirm rendering.

\`\`\`mermaid
graph TD
  A[Start] --> B{Choice}
  B -->|yes| C[Do thing]
  B -->|no| D[Stop]
\`\`\`

| Col A | Col B |
| ----- | ----- |
| one   | two   |
`

const LONG_LINE_SAMPLE =
    'this_is_a_single_very_long_line_without_spaces_' +
    'x'.repeat(400) +
    '_end_of_line'

function contentForPath(path: string): string {
    return /\.(md|markdown|mdown|mkd|mkdn|mdwn)$/i.test(path) ? MARKDOWN_SAMPLE : LONG_LINE_SAMPLE
}

function getTargetFile(): string {
    const url = new URL(window.location.href)
    return url.searchParams.get('file') ?? 'README.md'
}

function buildBlock(targetFile: string): ToolCallBlock {
    return {
        id: 'tool-read',
        localId: null,
        createdAt: 0,
        kind: 'tool-call',
        children: [],
        tool: {
            id: 'tool-read',
            name: 'Read',
            state: 'completed',
            input: { file_path: targetFile },
            result: { file: { filePath: targetFile, content: contentForPath(targetFile) } },
            createdAt: 0,
            startedAt: null,
            completedAt: 0,
            description: null,
        },
    }
}

const api = {} as unknown as ApiClient

const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
})

function App() {
    const targetFile = React.useMemo(() => getTargetFile(), [])
    const block = React.useMemo(() => buildBlock(targetFile), [targetFile])
    const ResultView = getToolResultViewComponent('Read')

    return (
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <AppContextProvider value={{ api, token: 'e2e', baseUrl: 'http://localhost' }}>
                    <div data-testid="tool-file-preview-host" style={{ padding: 16 }}>
                        <ResultView block={block} metadata={null} surface="dialog" />
                    </div>
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
