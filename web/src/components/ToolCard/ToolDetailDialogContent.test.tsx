import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolCallBlock } from '@/chat/types'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import { ToolDetailDialogContent } from '@/components/ToolCard/ToolCard'
import { I18nProvider } from '@/lib/i18n-context'

vi.mock('@/components/MarkdownRenderer', () => ({
    MarkdownRenderer: (props: { content: string; className?: string }) => (
        <div className={props.className}>{props.content}</div>
    )
}))

function makeAskUserQuestionBlock(permissionStatus: 'pending' | 'approved' | null): ToolCallBlock {
    const id = 'ask-1'
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 1,
        invokedAt: null,
        tool: {
            id,
            name: 'AskUserQuestion',
            state: permissionStatus === 'pending' ? 'pending' : 'running',
            input: {
                questions: [
                    {
                        header: '行号形态',
                        question: '预览模式下的行号，你希望是哪种形态？',
                        multiSelect: false,
                        options: [
                            { label: '左侧 gutter 一列行号 + 右侧 markdown 渲染', description: 'gutter 版' },
                            { label: '预览不带行号，行号只出现在"原文"tab', description: 'GitHub 行为' },
                            { label: '预览保留每行结构 + gutter 行号（不做块级合并）', description: '严格对齐版' }
                        ]
                    }
                ]
            },
            createdAt: 1,
            startedAt: null,
            completedAt: null,
            execStartedAt: null,
            execCompletedAt: null,
            description: null,
            result: undefined,
            permission: permissionStatus === null
                ? undefined
                : permissionStatus === 'pending'
                    ? { id: 'perm-1', status: 'pending' }
                    : { id: 'perm-1', status: 'approved', answers: { '0': ['gutter 版'] } }
        },
        children: []
    }
}

function renderDialogContent(block: ToolCallBlock, onClose = vi.fn()) {
    return render(
        <I18nProvider>
            <HappyChatProvider value={{
                api: {} as never,
                sessionId: 'session-1',
                metadata: { path: 'repo', host: 'local' },
                terminalToolDisplayMode: 'detailed',
                disabled: false,
                onRefresh: vi.fn(),
                hasMoreMessages: false,
                isLoadingMoreMessages: false,
                loadOlderMessagesPreservingScroll: vi.fn(async () => false)
            }}>
                <ToolDetailDialogContent
                    block={block}
                    metadata={{ path: 'repo', host: 'local' }}
                    onClose={onClose}
                />
            </HappyChatProvider>
        </I18nProvider>
    )
}

describe('ToolDetailDialogContent', () => {
    afterEach(() => {
        cleanup()
    })

    it('renders the interactive AskUserQuestion footer with radio options and a submit button when permission is pending', () => {
        const view = renderDialogContent(makeAskUserQuestionBlock('pending'))

        const radios = within(view.container).getAllByRole('radio')
        expect(radios.length).toBeGreaterThanOrEqual(3)

        // Every radio must be a real, enabled button — not a decorative card.
        for (const radio of radios) {
            expect(radio.tagName).toBe('BUTTON')
            expect(radio).not.toBeDisabled()
        }

        // A submit button should be present so the user can actually answer.
        expect(screen.getByRole('button', { name: /submit|提交/i })).toBeInTheDocument()

        // Read-only labels from AskUserQuestionView should NOT also appear —
        // the dialog is fully replaced by the interactive footer.
        expect(screen.queryByText(/Input|输入/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/Result|结果/i)).not.toBeInTheDocument()
    })

    it('falls back to the read-only view once the permission is answered', () => {
        const view = renderDialogContent(makeAskUserQuestionBlock('approved'))

        // No interactive controls when the request is already resolved.
        expect(within(view.container).queryAllByRole('radio')).toHaveLength(0)
        expect(screen.queryByRole('button', { name: /submit|提交/i })).not.toBeInTheDocument()

        // Read-only sections should render.
        expect(screen.getAllByText(/Questions & Answers|问答|Input|输入/i).length).toBeGreaterThan(0)
    })
})
