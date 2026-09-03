import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiClient } from '@/api/client'
import { HappyThread } from '@/components/AssistantChat/HappyThread'
import { I18nProvider } from '@/lib/i18n-context'
import type { Session } from '@/types/api'
import type { OlderLoadOutcome } from '@/lib/message-window-store'

vi.mock('@assistant-ui/react', () => ({
    ThreadPrimitive: {
        Root: ({ children }: PropsWithChildren) => <div>{children}</div>,
        Viewport: ({ children }: PropsWithChildren) => <>{children}</>,
        Messages: () => <div id="stable-visible-message" data-testid="stable-visible-message" />,
        Unstable_MessageById: () => <div id="stable-visible-message" data-testid="stable-visible-message" />,
    },
    useAuiState<T>(selector: (state: { thread: { extras: undefined } }) => T): T {
        return selector({ thread: { extras: undefined } })
    },
    unstable_useThreadMessageIds: (): string[] => ['stable-visible-message'],
}))

vi.mock('@/hooks/queries/useMachines', () => ({
    useMachines: () => ({
        machines: [],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
    }),
}))

const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')

beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
        configurable: true,
        value(this: HTMLElement, options: ScrollToOptions) {
            if (typeof options.top === 'number') {
                this.scrollTop = options.top
            }
        },
    })
})

afterAll(() => {
    if (scrollToDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor)
        return
    }
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
})

const api = new ApiClient('test-token')
vi.spyOn(api, 'getHubSettings').mockResolvedValue({
    sessionSummaryContract: false,
    sessionSummaryInChat: false
})
const session: Session = {
    id: 'pagination-session',
    namespace: 'default',
    seq: 1,
    createdAt: 0,
    updatedAt: 0,
    active: true,
    activeAt: 0,
    metadata: null,
    metadataVersion: 1,
    agentState: null,
    agentStateVersion: 1,
    thinking: false,
    thinkingAt: 0,
    model: null,
    modelReasoningEffort: null,
    effort: null,
    serviceTier: null,
    resumeWithSessionModel: false,
}


function PaginationHarness(props: { onRequest: () => void }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const [committedPageCount, setCommittedPageCount] = useState(0)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const pendingResolveRef = useRef<((outcome: OlderLoadOutcome) => void) | null>(null)
    const pendingBeforeApplyRef = useRef<((historyVersion: number) => boolean) | null>(null)

    const onLoadMore = useCallback((onBeforeApply?: (historyVersion: number) => boolean) => {
        props.onRequest()
        pendingBeforeApplyRef.current = onBeforeApply ?? null
        setIsLoadingMore(true)
        return new Promise<OlderLoadOutcome>((resolve) => {
            pendingResolveRef.current = resolve
        })
    }, [props.onRequest])

    useEffect(() => {
        if (!isLoadingMore) return

        const historyVersion = committedPageCount + 1
        const shouldApply = pendingBeforeApplyRef.current?.(historyVersion) ?? true
        pendingBeforeApplyRef.current = null
        setIsLoadingMore(false)
        if (!shouldApply) {
            pendingResolveRef.current?.({ kind: 'stopped', reason: 'invalidated' })
            pendingResolveRef.current = null
            return
        }
        setCommittedPageCount(historyVersion)
        pendingResolveRef.current?.({
            kind: 'applied',
            historyVersion,
            hasMore: historyVersion < 3,
            addedRenderableCount: 1
        })
        pendingResolveRef.current = null
    }, [committedPageCount, isLoadingMore])

    return (
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <output data-testid="page">{committedPageCount}</output>
                <HappyThread
                    api={api}
                    session={session}
                    sessionId="pagination-session"
                    metadata={null}
                    disabled={false}
                    onRefresh={() => undefined}
                    messagesWarning={null}
                    hasMoreMessages={committedPageCount < 3}
                    isLoadingMoreMessages={isLoadingMore}
                    onLoadMore={onLoadMore}
                    onCancelLoadMore={() => undefined}
                    onViewModeChange={() => undefined}
                    isSyncingTail={false}
                    unseenCount={0}
                    rawMessagesCount={1}
                    normalizedMessagesCount={1}
                    messagesVersion={committedPageCount}
                    historyVersion={committedPageCount}
                    forceScrollToken={0}
                    outlineOpen={false}
                    outlineItems={[]}
                    onOutlineOpenChange={() => undefined}
                />
            </I18nProvider>
        </QueryClientProvider>
    )
}

describe('HappyThread older-history pagination lifecycle', () => {
    it('continues loading after each committed page until hidden history is exhausted', async () => {
        const onRequest = vi.fn()
        render(<PaginationHarness onRequest={onRequest} />)

        const viewport = document.querySelector<HTMLElement>('.app-scroll-y')
        if (!viewport) {
            throw new Error('Message viewport was not rendered')
        }
        const anchor = screen.getByTestId('stable-visible-message')
        const pageCountOutput = screen.getByTestId('page')
        Object.defineProperty(viewport, 'clientHeight', {
            configurable: true,
            value: 104,
        })
        Object.defineProperty(viewport, 'scrollHeight', {
            configurable: true,
            get: () => pageCountOutput.textContent === '3' ? 205 : 171,
        })
        viewport.getBoundingClientRect = () => DOMRect.fromRect({ height: 104, width: 400 })
        anchor.getBoundingClientRect = () => {
            const insertedHeight = pageCountOutput.textContent === '3' ? 34 : 0
            return DOMRect.fromRect({
                y: 61 + insertedHeight - viewport.scrollTop,
                height: 20,
                width: 100,
            })
        }
        viewport.scrollTop = 0

        fireEvent.click(screen.getByRole('button', { name: 'Load earlier' }))

        await waitFor(() => expect(onRequest).toHaveBeenCalledTimes(3))
        await waitFor(() => expect(viewport.scrollTop).toBe(34))
        expect(anchor.getBoundingClientRect().top).toBe(61)
        expect(screen.queryByRole('button', { name: 'Load earlier' })).not.toBeInTheDocument()
    })
})
