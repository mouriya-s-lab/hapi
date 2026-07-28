import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { ApiClient } from '@/api/client'
import type { GeneratedImageBlock } from '@/chat/types'
import { HappyChatProvider, type HappyChatContextValue } from '@/components/AssistantChat/context'
import { GeneratedImageCard } from './ToolMessage'

function block(imageId: string, fileName: string, mimeType: string): GeneratedImageBlock {
    return {
        kind: 'generated-image',
        id: `message:${imageId}`,
        localId: null,
        createdAt: 1,
        imageId,
        fileName,
        mimeType
    }
}

function context(getGeneratedImageBlob: (sessionId: string, imageId: string) => Promise<Blob>): HappyChatContextValue {
    return {
        api: { getGeneratedImageBlob } as unknown as ApiClient,
        sessionId: 'session-1',
        metadata: null,
        terminalToolDisplayMode: 'detailed',
        disabled: false,
        onRefresh: () => undefined,
        hasMoreMessages: false,
        isLoadingMoreMessages: false,
        loadOlderMessagesPreservingScroll: async () => false
    }
}

describe('GeneratedImageCard', () => {
    afterEach(() => vi.restoreAllMocks())

    it('renders video MIME as an inline controlled video', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video-1')
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
        const value = context(async () => new Blob(['mp4'], { type: 'video/mp4' }))

        const { container } = render(
            <HappyChatProvider value={value}>
                <GeneratedImageCard block={block('video-1', 'recording.mp4', 'video/mp4')} />
            </HappyChatProvider>
        )

        expect(await screen.findByText('Generated video · recording.mp4')).toBeInTheDocument()
        await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
        const video = container.querySelector('video')
        expect(video?.getAttribute('src')).toBe('blob:video-1')
        expect(video?.controls).toBe(true)
        expect(video?.playsInline).toBe(true)
    })

    it('revokes stale media immediately when imageId changes', async () => {
        const createObjectURL = vi.spyOn(URL, 'createObjectURL')
            .mockReturnValueOnce('blob:image-1')
            .mockReturnValueOnce('blob:image-2')
        const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
        const value = context(async (_sessionId, imageId) => new Blob([imageId], { type: 'image/png' }))

        const view = render(
            <HappyChatProvider value={value}>
                <GeneratedImageCard block={block('image-1', 'first.png', 'image/png')} />
            </HappyChatProvider>
        )
        await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))

        view.rerender(
            <HappyChatProvider value={value}>
                <GeneratedImageCard block={block('image-2', 'second.png', 'image/png')} />
            </HappyChatProvider>
        )

        await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2))
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:image-1')
    })
})
