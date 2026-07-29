import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '@/api/client'
import { HappyThread } from '@/components/AssistantChat/HappyThread'
import { I18nProvider } from '@/lib/i18n-context'

vi.mock('@assistant-ui/react', () => ({
    ThreadPrimitive: {
        Root: ({ children }: PropsWithChildren) => <div>{children}</div>,
        Viewport: ({ children }: PropsWithChildren) => <>{children}</>,
        Messages: () => <div id="stable-visible-message" data-testid="stable-visible-message" />,
    },
    useAssistantState<T>(selector: (state: { thread: { extras: undefined } }) => T): T {
        return selector({ thread: { extras: undefined } })
    },
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

function PaginationHarness(props: { onRequest: () => void }) {
    const [committedPageCount, setCommittedPageCount] = useState(0)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const pendingResolveRef = useRef<((loaded: boolean) => void) | null>(null)

    const onLoadMore = useCallback(() => {
        props.onRequest()
        setIsLoadingMore(true)
        return new Promise<boolean>((resolve) => {
            pendingResolveRef.current = resolve
        })
    }, [props.onRequest])

    useEffect(() => {
        if (!isLoadingMore) return

        setCommittedPageCount((count) => count + 1)
        setIsLoadingMore(false)
        pendingResolveRef.current?.(true)
        pendingResolveRef.current = null
    }, [isLoadingMore])

    return (
        <I18nProvider>
            <output data-testid="page">{committedPageCount}</output>
            <HappyThread
                api={api}
                sessionId="pagination-session"
                metadata={null}
                disabled={false}
                onRefresh={() => undefined}
                messagesWarning={null}
                hasMoreMessages={committedPageCount < 3}
                isLoadingMoreMessages={isLoadingMore}
                onLoadMore={onLoadMore}
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

        fireEvent.click(screen.getByRole('button', { name: 'Load older' }))

        await waitFor(() => expect(onRequest).toHaveBeenCalledTimes(3))
        await waitFor(() => expect(viewport.scrollTop).toBe(34))
        expect(anchor.getBoundingClientRect().top).toBe(61)
        expect(screen.queryByRole('button', { name: 'Load older' })).not.toBeInTheDocument()
    })
})
