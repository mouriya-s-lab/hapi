import type { AgentEvent } from '@/chat/types'
import type { VisibleChatBlock } from '@/chat/toolGroups'

export function isEventVisibleForFlavor(
    event: AgentEvent,
    flavor: string | null | undefined
): boolean {
    if (flavor !== 'omp') return true
    return event.type !== 'limit-warning' && event.type !== 'limit-reached'
}

export function filterVisibleBlocksForFlavor(
    blocks: readonly VisibleChatBlock[],
    flavor: string | null | undefined
): VisibleChatBlock[] {
    return blocks.filter((block) => (
        block.kind !== 'agent-event' || isEventVisibleForFlavor(block.event, flavor)
    ))
}
