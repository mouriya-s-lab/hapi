import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { EventNotice } from '@/components/AssistantChat/messages/EventNotice'
import { getEventPresentation } from '@/chat/presentation'

function renderNotice(props: { icon?: string | null; text: string; details?: string | null }) {
    return render(
        <I18nProvider>
            <EventNotice {...props} />
        </I18nProvider>
    )
}

describe('EventNotice', () => {
    afterEach(cleanup)

    it('renders an ordinary event as a plain one-line notice', () => {
        renderNotice({ icon: '📦', text: 'Conversation compacted' })

        expect(screen.getByText('Conversation compacted')).toBeInTheDocument()
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('keeps an unsupported payload collapsed until the user opens it', () => {
        const payload = JSON.stringify({ type: 'tool_progress', heartbeat: true }, null, 2)
        renderNotice({
            icon: '⋯',
            text: 'Unsupported message · output/tool_progress',
            details: payload
        })

        // 折叠态:只有一行提示,原始 JSON 不进会话流
        expect(screen.getByText('Unsupported message · output/tool_progress')).toBeInTheDocument()
        expect(screen.queryByText(/heartbeat/)).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button'))

        expect(screen.getByText(/heartbeat/)).toBeInTheDocument()
    })

    it('renders the unsupported-payload event produced by the normalizer', () => {
        const presentation = getEventPresentation({
            type: 'unsupported-payload',
            payloadType: 'output/tool_progress',
            payload: '{"heartbeat":true}'
        })

        renderNotice(presentation)

        expect(screen.getByText('Unsupported message · output/tool_progress')).toBeInTheDocument()
        expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    })
})
