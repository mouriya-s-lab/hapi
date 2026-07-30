import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { AgentEventBlock, ToolCallBlock } from '@/chat/types'
import {
    HappyChatProvider,
    type HappyChatContextValue
} from '@/components/AssistantChat/context'
import { HappyToolMessage } from '@/components/AssistantChat/messages/ToolMessage'

vi.mock('@/components/ToolCard/ToolCard', () => ({
    ToolCard: () => <div>Parent tool</div>
}))

function agentEvent(id: string, event: AgentEventBlock['event']): AgentEventBlock {
    return { kind: 'agent-event', id, createdAt: 0, event }
}

function parentTool(): ToolCallBlock {
    return {
        kind: 'tool-call',
        id: 'parent',
        localId: null,
        createdAt: 0,
        tool: {
            id: 'parent',
            name: 'wrapper',
            state: 'completed',
            input: {},
            createdAt: 0,
            startedAt: 0,
            completedAt: 1,
            execStartedAt: null,
            execCompletedAt: null,
            description: null
        },
        children: [
            agentEvent('quota', {
                type: 'limit-warning',
                utilization: 0.9,
                endsAt: 1,
                limitType: 'five_hour'
            }),
            agentEvent('retry', { type: 'omp-retry', phase: 'started' })
        ]
    }
}

function context(flavor: string): HappyChatContextValue {
    return {
        api: {} as ApiClient,
        sessionId: 'session-1',
        metadata: { path: 'repo', host: 'local', flavor },
        terminalToolDisplayMode: 'detailed',
        disabled: false,
        onRefresh: () => undefined,
        hasMoreMessages: false,
        isLoadingMoreMessages: false,
        loadOlderMessagesPreservingScroll: async () => false
    }
}

function props(artifact: ToolCallBlock): ToolCallMessagePartProps {
    return {
        type: 'tool-call',
        toolCallId: artifact.id,
        toolName: artifact.tool.name,
        args: {},
        argsText: '{}',
        artifact,
        status: { type: 'complete' },
        addResult: () => undefined,
        resume: () => undefined
    }
}

describe('HappyToolMessage event visibility', () => {
    it('hides quota events only for nested OMP output while preserving retries', () => {
        const artifact = parentTool()
        const view = render(
            <HappyChatProvider value={context('omp')}>
                <HappyToolMessage {...props(artifact)} />
            </HappyChatProvider>
        )

        expect(screen.queryByText(/^Usage limit 90%/)).not.toBeInTheDocument()
        expect(screen.getByText('OMP retry started')).toBeInTheDocument()

        view.rerender(
            <HappyChatProvider value={context('claude')}>
                <HappyToolMessage {...props(artifact)} />
            </HappyChatProvider>
        )
        expect(screen.getByText(/^Usage limit 90%/)).toBeInTheDocument()
    })
})
