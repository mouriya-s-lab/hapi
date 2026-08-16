/*
 * Standalone fixture for the OMP tool-result render regression.
 *
 * Uses the exact tool_result shape captured from production omp session
 * 019fef33-ca42-7000-9de2-b475ea5b2c97: lowercase tool name (`read`, `bash`,
 * `grep`, `todo`), content array carrying a truncation notice, and the real
 * body sitting under details.displayContent.text.
 *
 * Before the fix these fall through GenericResultView → renderText(mode:auto)
 * → MarkdownRenderer, which parses the code-shaped text as prose and collapses
 * every newline / indent into a single unreadable run of characters. After the
 * fix the alias registry routes `read` → ReadResultView (CodeBlock with real
 * line numbers) and `todo` → TodoWriteView (checklist), and
 * extractTextFromResult prefers details.displayContent over the truncated
 * content notice so the fuller body reaches the code block.
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

const READ_BODY = [
    'export async function runHappyMcpStdioBridge(argv: string[]): Promise<void> {',
    '    try {',
    '        const sendFileInputSchema: z.ZodTypeAny = z.object({',
    "            path: z.string().describe('Local filesystem path of the file to send to the user'),",
    "            title: z.string().optional().describe('Optional display title or filename for the file'),",
    '        })',
    '',
    "        server.registerTool<any, any>('send_file', {",
    "            description: 'Snapshot a local regular file and send the snapshot to the current HAPI chat for download',",
    '            inputSchema: sendFileInputSchema.shape,',
    "        }, async (args, extra) => { /* ... */ })",
    '    } catch (err) {',
    '        console.error(err)',
    '    }',
    '}'
].join('\n')

const BASH_OUTPUT = [
    'On branch hapi-0811-cb45',
    'nothing to commit, working tree clean',
    '---',
    'hapi-0811-cb45',
    '---',
    'fe92a0f0 Merge pull request #281 from mouriya-s-lab/sync/merge',
    'e3b82231 chore: recheck merge against main after scrollStability optional fix',
    '784f0517 Merge pull request #279 from mouriya-s-lab/sync/merge'
].join('\n')

const GREP_OUTPUT = [
    '# shared/src/',
    '## apiTypes.ts#A132',
    ' 285:export const SessionResumeModelRequestSchema = z.object({',
    '*286:    resumeWithSessionModel: z.boolean()',
    ' 287:})',
    '## schemas.ts#EE24',
    ' 374:    serviceTier: z.string().nullable().optional().default(null),',
    '*375:    resumeWithSessionModel: z.boolean().default(false)',
    ' 376:})'
].join('\n')

const TRUNCATION_NOTICE = '\n\n[Showing lines 2-2 of 2 (20.0KB limit). Read artifact://2 for full output]'

type Fixture = {
    id: string
    label: string
    block: ToolCallBlock
}

function makeBlock(
    id: string,
    name: string,
    input: unknown,
    result: unknown
): ToolCallBlock {
    return {
        id,
        localId: null,
        createdAt: 0,
        kind: 'tool-call',
        children: [],
        tool: {
            id,
            name,
            state: 'completed',
            input,
            result,
            createdAt: 0,
            startedAt: null,
            completedAt: 0,
            execStartedAt: null,
            execCompletedAt: null,
            description: null,
        },
    }
}

const FIXTURES: Fixture[] = [
    {
        id: 'read-truncated',
        label: 'read — truncation notice in content[], real body in details.displayContent (production shape)',
        block: makeBlock(
            'omp-read-1',
            'read',
            { path: 'cli/src/codex/happyMcpStdioBridge.ts' },
            {
                content: [{ type: 'text', text: TRUNCATION_NOTICE }],
                details: {
                    totalLines: 15,
                    resolvedPath: '/repo/cli/src/codex/happyMcpStdioBridge.ts',
                    displayContent: { text: READ_BODY, startLine: 44 },
                },
                isError: false,
            }
        ),
    },
    {
        id: 'read-inline-body',
        label: 'read — body in content[] and details.displayContent (typical read)',
        block: makeBlock(
            'omp-read-2',
            'read',
            { path: 'cli/src/codex/happyMcpStdioBridge.ts' },
            {
                content: [{ type: 'text', text: READ_BODY }],
                details: {
                    totalLines: 15,
                    resolvedPath: '/repo/cli/src/codex/happyMcpStdioBridge.ts',
                    displayContent: { text: READ_BODY, startLine: 44 },
                },
                isError: false,
            }
        ),
    },
    {
        id: 'bash-lowercase',
        label: 'bash — lowercase tool name should route through BashResultView',
        block: makeBlock(
            'omp-bash-1',
            'bash',
            { command: "git status && echo '---' && git branch --show-current" },
            {
                content: [{ type: 'text', text: BASH_OUTPUT }],
                details: { exitCode: 0 },
                isError: false,
            }
        ),
    },
    {
        id: 'read-tsx-line-range',
        label: 'read — OMP path with :997-1000 selector, real startLine + tsx language',
        block: makeBlock(
            'omp-read-3',
            'read',
            { path: 'web/src/components/SessionList.tsx:997-1000' },
            {
                content: [{ type: 'text', text: '\n\n[Showing lines 997-1000 of 1234]' }],
                details: {
                    displayContent: {
                        text: [
                            "const { attentionId, scheduleId, describedBy } = useSessionRowTooltipIds(",
                            "    ...longPressHandlers,",
                            ")",
                            "return ("
                        ].join('\n'),
                        startLine: 997,
                    },
                },
                isError: false,
            }
        ),
    },
    {
        id: 'grep-lowercase',
        label: 'grep — lowercase tool name should render as a line list',
        block: makeBlock(
            'omp-grep-1',
            'grep',
            { pattern: 'resumeWithSessionModel', path: 'shared/src' },
            {
                content: [{ type: 'text', text: GREP_OUTPUT }],
                details: { matchCount: 3, fileCount: 2 },
                isError: false,
            }
        ),
    },
    {
        id: 'todo-lowercase',
        label: 'todo — lowercase tool name should render as a checklist',
        block: makeBlock(
            'omp-todo-1',
            'todo',
            { op: 'init' },
            {
                content: [{ type: 'text', text: 'todo list preview' }],
                details: {
                    op: 'init',
                    phases: [
                        {
                            name: 'Resolve',
                            tasks: [
                                { content: 'Regen build lock', status: 'completed' },
                                { content: 'Resolve CLI MCP tools', status: 'in_progress' },
                                { content: 'Resolve generated media', status: 'pending' },
                            ],
                        },
                    ],
                },
                isError: false,
            }
        ),
    },
]

const api = {} as unknown as ApiClient
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })

function FixtureCard(props: { fixture: Fixture }) {
    const ResultView = getToolResultViewComponent(props.fixture.block.tool.name)
    return (
        <section
            data-testid={`fixture-${props.fixture.id}`}
            data-tool-name={props.fixture.block.tool.name}
            style={{
                marginBottom: 24,
                padding: 12,
                borderRadius: 12,
                border: '1px solid var(--app-border, #d0d7de)',
                background: 'var(--app-secondary-bg, #f6f8fa)',
            }}
        >
            <div style={{ marginBottom: 8, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, opacity: 0.75 }}>
                {props.fixture.label}
            </div>
            <ResultView block={props.fixture.block} metadata={null} surface="inline" />
        </section>
    )
}

function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <AppContextProvider value={{ api, token: 'e2e', baseUrl: 'http://localhost' }}>
                    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
                        <h1 style={{ marginBottom: 16, fontSize: 20 }}>OMP tool render — fixture</h1>
                        {FIXTURES.map((fixture) => (
                            <FixtureCard key={fixture.id} fixture={fixture} />
                        ))}
                    </div>
                </AppContextProvider>
            </I18nProvider>
        </QueryClientProvider>
    )
}

const container = document.getElementById('root')
if (!container) throw new Error('root missing')
ReactDOM.createRoot(container).render(<App />)
