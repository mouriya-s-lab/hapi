import { MessagePrimitive, useAssistantState } from '@assistant-ui/react'
import { getEventPresentation } from '@/chat/presentation'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { getConversationMessageAnchorId } from '@/chat/outline'
import { EventNotice } from '@/components/AssistantChat/messages/EventNotice'
import { MessageTimestamp } from '@/components/AssistantChat/messages/MessageTimestamp'

export function HappySystemMessage() {
    const role = useAssistantState(({ message }) => message.role)
    const messageId = useAssistantState(({ message }) => message.id)
    const text = useAssistantState(({ message }) => {
        if (message.role !== 'system') return ''
        return message.content[0]?.type === 'text' ? message.content[0].text : ''
    })
    // icon / details 都来自事件本身，文本仍取 message.content（和 runtime 的
    // renderEventLabel 保持一致）。这里逐个选出标量而不是整个 presentation 对象：
    // useAssistantState 的 selector 每次返回新对象会让快照永远"变了"，触发无谓重渲染。
    const icon = useAssistantState(({ message }) => {
        if (message.role !== 'system') return null
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        const event = custom?.kind === 'event' ? custom.event : undefined
        return event ? getEventPresentation(event).icon : null
    })
    const details = useAssistantState(({ message }) => {
        if (message.role !== 'system') return null
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        const event = custom?.kind === 'event' ? custom.event : undefined
        return (event ? getEventPresentation(event).details : null) ?? null
    })

    if (role !== 'system') return null

    return (
        <MessagePrimitive.Root id={getConversationMessageAnchorId(messageId)} className="scroll-mt-4 py-1">
            <EventNotice
                icon={icon}
                text={text}
                details={details}
                trailing={<MessageTimestamp className="text-[10px]" />}
            />
        </MessagePrimitive.Root>
    )
}
