import { MessagePrimitive, useAssistantState } from '@assistant-ui/react'
import { getEventPresentation } from '@/chat/presentation'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { getConversationMessageAnchorId } from '@/chat/outline'
import { MessageTimestamp } from '@/components/AssistantChat/messages/MessageTimestamp'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { useState } from 'react'

export function HappySystemMessage() {
    const [summaryExpanded, setSummaryExpanded] = useState(false)
    const role = useAssistantState(({ message }) => message.role)
    const messageId = useAssistantState(({ message }) => message.id)
    const text = useAssistantState(({ message }) => {
        if (message.role !== 'system') return ''
        return message.content[0]?.type === 'text' ? message.content[0].text : ''
    })
    const icon = useAssistantState(({ message }) => {
        if (message.role !== 'system') return null
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        const event = custom?.kind === 'event' ? custom.event : undefined
        return event ? getEventPresentation(event).icon : null
    })
    const compactSummary = useAssistantState(({ message }) => {
        if (message.role !== 'system') return null
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        const event = custom?.kind === 'event' ? custom.event : undefined
        return event?.type === 'compact-summary' && typeof event.summary === 'string' ? event.summary : null
    })

    if (role !== 'system') return null

    if (compactSummary) {
        return (
            <MessagePrimitive.Root id={getConversationMessageAnchorId(messageId)} className="scroll-mt-4 py-1">
                <div className="mx-auto w-full max-w-[92%] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)]">
                    <button
                        type="button"
                        aria-expanded={summaryExpanded}
                        onClick={() => setSummaryExpanded((expanded) => !expanded)}
                        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                    >
                        <span aria-hidden="true">📦</span>
                        <span className="font-medium">Compacted</span>
                        <span className="ml-auto">{summaryExpanded ? '▾' : '›'}</span>
                        <MessageTimestamp className="text-[10px]" />
                    </button>
                    {summaryExpanded ? (
                        <div className="border-t border-[var(--app-border)] px-4 py-3 text-sm">
                            <MarkdownRenderer content={compactSummary} />
                        </div>
                    ) : null}
                </div>
            </MessagePrimitive.Root>
        )
    }

    return (
        <MessagePrimitive.Root id={getConversationMessageAnchorId(messageId)} className="scroll-mt-4 py-1">
            <div className="mx-auto w-fit max-w-[92%] px-2 text-center text-xs text-[var(--app-hint)] opacity-80">
                <span className="inline-flex items-center gap-1">
                    {icon ? <span aria-hidden="true">{icon}</span> : null}
                    <span>{text}</span>
                    <MessageTimestamp className="text-[10px]" />
                </span>
            </div>
        </MessagePrimitive.Root>
    )
}
