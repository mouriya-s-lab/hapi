import { describe, expect, it } from 'vitest'
import type { AgentEventBlock, AgentTextBlock } from '@/chat/types'
import type { VisibleChatBlock } from '@/chat/toolGroups'
import { filterVisibleBlocksForFlavor, isEventVisibleForFlavor } from './eventVisibility'

function agentEvent(id: string, event: AgentEventBlock['event']): AgentEventBlock {
    return { kind: 'agent-event', id, createdAt: 0, event }
}

function agentText(id: string): AgentTextBlock {
    return { kind: 'agent-text', id, localId: null, createdAt: 0, text: id }
}

describe('OMP event visibility', () => {
    it.each(['limit-warning', 'limit-reached'] as const)(
        'hides %s for OMP because native RPC does not report quota limits',
        (type) => {
            expect(isEventVisibleForFlavor({ type }, 'omp')).toBe(false)
        }
    )

    it('keeps native OMP retry events visible', () => {
        expect(isEventVisibleForFlavor({ type: 'omp-retry', phase: 'started' }, 'omp')).toBe(true)
    })

    it('keeps Claude limit events visible', () => {
        expect(isEventVisibleForFlavor({ type: 'limit-warning' }, 'claude')).toBe(true)
    })

    it('filters only unsupported OMP quota blocks', () => {
        const blocks: VisibleChatBlock[] = [
            agentEvent('warning', { type: 'limit-warning', utilization: 0.9, endsAt: 1, limitType: 'five_hour' }),
            agentEvent('reached', { type: 'limit-reached', endsAt: 2, limitType: 'five_hour' }),
            agentEvent('retry', { type: 'omp-retry', phase: 'started' }),
            agentText('answer')
        ]

        expect(filterVisibleBlocksForFlavor(blocks, 'omp').map((block) => block.id)).toEqual([
            'retry',
            'answer'
        ])
        expect(filterVisibleBlocksForFlavor(blocks, 'claude')).toEqual(blocks)
    })
})
