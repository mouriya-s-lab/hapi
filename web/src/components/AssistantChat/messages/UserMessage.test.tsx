import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

// vi.mock is hoisted; the state object must exist by then. vi.hoisted runs
// even earlier, and vi is safe to use inside its factory (documented behavior).
const state = vi.hoisted(() => {
    return {
        forkSession: vi.fn(async () => ({ newSessionId: 'new-forked-id' })),
        navigate: vi.fn(async () => undefined),
        setForkedFromText: vi.fn<(sessionId: string, text: string) => void>(),
        isPending: false,
        messageId: 'msg-42' as string,
        text: 'source user prompt' as string,
        flavor: 'codex' as string | null,
        capabilities: {
            capabilities: {
                codex: { fork: 'at-message', files: 'none' },
                claude: { fork: 'head-only', files: 'none' },
                cursor: { fork: 'none', files: 'none' }
            }
        } as any
    }
})

vi.mock('@assistant-ui/react', () => ({
    MessagePrimitive: {
        Root: (props: { children?: ReactNode; id?: string; className?: string }) => (
            <div data-testid="msg-root" id={props.id} className={props.className}>
                {props.children}
            </div>
        )
    },
    useAssistantState: (selector: (state: unknown) => unknown) =>
        selector({
            message: {
                role: 'user',
                id: state.messageId,
                content: [{ type: 'text', text: state.text }],
                metadata: { custom: {} }
            }
        })
}))

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => state.navigate
}))

vi.mock('@/hooks/queries/useFlavorCapabilities', () => ({
    useFlavorCapabilities: () => ({ data: state.capabilities }),
    getFlavorForkCapability: (caps: any, flavor: string | null | undefined) => {
        if (!caps || !flavor) return { fork: 'none', files: 'none' }
        return caps.capabilities[flavor] ?? { fork: 'none', files: 'none' }
    }
}))

vi.mock('@/hooks/mutations/useSessionActions', () => ({
    useSessionActions: () => ({
        forkSession: state.forkSession,
        isPending: state.isPending,
        // Stubs unused by the rewind path but kept to satisfy the interface.
        abortSession: vi.fn(),
        archiveSession: vi.fn(),
        reopenSession: vi.fn(),
        switchSession: vi.fn(),
        setPermissionMode: vi.fn(),
        setCollaborationMode: vi.fn(),
        setModel: vi.fn(),
        setResumeWithSessionModel: vi.fn(),
        setModelReasoningEffort: vi.fn(),
        setEffort: vi.fn(),
        setServiceTier: vi.fn(),
        renameSession: vi.fn(),
        deleteSession: vi.fn()
    })
}))

vi.mock('@/components/AssistantChat/context', () => ({
    useHappyChatContext: () => ({
        api: {} as any,
        sessionId: 'sess-src',
        metadata: { flavor: state.flavor },
        terminalToolDisplayMode: 'auto',
        disabled: false,
        onRefresh: () => {},
        onRetryMessage: undefined,
        hasMoreMessages: false,
        isLoadingMoreMessages: false,
        loadOlderMessagesPreservingScroll: async () => false
    })
}))

vi.mock('@/lib/fork-restore', () => ({
    setForkedFromText: state.setForkedFromText
}))

vi.mock('@/hooks/useCopyToClipboard', () => ({
    useCopyToClipboard: () => ({ copied: false, copy: vi.fn() })
}))

vi.mock('@/components/AssistantChat/messages/MessageStatusIndicator', () => ({
    MessageStatusIndicator: () => null
}))
vi.mock('@/components/AssistantChat/messages/MessageAttachments', () => ({
    MessageAttachments: () => null
}))
vi.mock('@/components/AssistantChat/messages/user-bubble', () => ({
    UserBubbleContent: ({ text }: { text: string }) => <span>{text}</span>,
    getUserBubbleClassName: () => '',
    shouldShowMessageStatus: () => false
}))
vi.mock('@/components/CliOutputBlock', () => ({ CliOutputBlock: () => null }))
vi.mock('@/components/icons', () => ({
    CopyIcon: () => null,
    CheckIcon: () => null
}))
vi.mock('@/chat/outline', () => ({
    getConversationMessageAnchorId: (id: string) => `anchor-${id}`
}))
vi.mock('@/components/AssistantChat/messages/MessageMetadata', () => ({
    MessageMetadata: () => null
}))
vi.mock('@/components/AssistantChat/messages/MessageTimestamp', () => ({
    MessageTimestamp: (props: { className?: string }) => (
        <span className={props.className}>ts</span>
    )
}))

// Import SUT after mocks so its module graph picks them up.
import { HappyUserMessage } from './UserMessage'

afterEach(() => {
    cleanup()
    state.forkSession.mockClear()
    state.navigate.mockClear()
    state.setForkedFromText.mockClear()
    state.forkSession.mockImplementation(async () => ({ newSessionId: 'new-forked-id' }))
    state.navigate.mockImplementation(async () => undefined)
    state.isPending = false
    state.messageId = 'msg-42'
    state.text = 'source user prompt'
    state.flavor = 'codex'
})

describe('HappyUserMessage rewind button (#62 c5)', () => {
    it('Codex flavor (at-message) → rewind button renders', () => {
        render(<HappyUserMessage />)
        expect(screen.getByRole('button', { name: /Rewind to this message/i })).toBeInTheDocument()
    })

    it('Claude flavor (head-only) → NO rewind button', () => {
        state.flavor = 'claude'
        render(<HappyUserMessage />)
        expect(screen.queryByRole('button', { name: /Rewind to this message/i })).toBeNull()
    })

    it('Cursor flavor (none) → NO rewind button', () => {
        state.flavor = 'cursor'
        render(<HappyUserMessage />)
        expect(screen.queryByRole('button', { name: /Rewind to this message/i })).toBeNull()
    })

    it('Unknown flavor falls back to none → NO rewind button', () => {
        state.flavor = 'never-heard-of-it'
        render(<HappyUserMessage />)
        expect(screen.queryByRole('button', { name: /Rewind to this message/i })).toBeNull()
    })

    it('Click calls forkSession with forkPoint.messageId → setForkedFromText → navigate', async () => {
        render(<HappyUserMessage />)
        fireEvent.click(screen.getByRole('button', { name: /Rewind to this message/i }))
        await waitFor(() =>
            expect(state.forkSession).toHaveBeenCalledWith({ forkPoint: { messageId: 'msg-42' } })
        )
        await waitFor(() =>
            expect(state.setForkedFromText).toHaveBeenCalledWith('new-forked-id', 'source user prompt')
        )
        await waitFor(() =>
            expect(state.navigate).toHaveBeenCalledWith({
                to: '/sessions/$sessionId',
                params: { sessionId: 'new-forked-id' }
            })
        )
    })

    it('Does not stash forked-from text when source message text is empty', async () => {
        state.text = ''
        render(<HappyUserMessage />)
        // With empty text UserMessage still renders trailing row but bubble is
        // hidden; the rewind button is capability-gated on flavor, not text.
        // If click still fires, setForkedFromText should be skipped.
        const btn = screen.queryByRole('button', { name: /Rewind to this message/i })
        if (btn) {
            fireEvent.click(btn)
            await waitFor(() => expect(state.forkSession).toHaveBeenCalled())
            expect(state.setForkedFromText).not.toHaveBeenCalled()
        }
    })

    it('When aggregated isPending is true → button is disabled', () => {
        state.isPending = true
        render(<HappyUserMessage />)
        expect(
            screen.getByRole('button', { name: /Rewind to this message/i })
        ).toBeDisabled()
    })
})
