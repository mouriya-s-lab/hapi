import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { ChatToolCall } from '@/chat/types'
import { I18nProvider } from '@/lib/i18n-context'
import { RequestUserInputFooter } from './RequestUserInputFooter'

vi.mock('@/components/MarkdownRenderer', () => ({
    MarkdownRenderer: (props: { content: string }) => <div>{props.content}</div>
}))

function makeTool(): ChatToolCall {
    return {
        id: 'tool-1',
        name: 'request_user_input',
        state: 'pending',
        input: { ompTransientRequest: true },
        createdAt: 1,
        startedAt: null,
        completedAt: null,
        execStartedAt: null,
        execCompletedAt: null,
        description: null,
        permission: { id: 'request-1', status: 'pending' }
    }
}

function renderFooter(api: ApiClient) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    })
    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <RequestUserInputFooter
                    api={api}
                    sessionId="session-1"
                    tool={makeTool()}
                    disabled={false}
                    onDone={vi.fn()}
                />
            </I18nProvider>
        </QueryClientProvider>
    )
}

describe('RequestUserInputFooter transient OMP input', () => {
    it('loads a provider URL only through the authenticated transient API', async () => {
        const response = Promise.withResolvers<Awaited<ReturnType<ApiClient['getSessionOmpExtensionUiRequest']>>>()
        const getSessionOmpExtensionUiRequest = vi.fn(async () => await response.promise)
        const api = {
            getSessionOmpExtensionUiRequest,
            approvePermission: vi.fn()
        } as unknown as ApiClient

        renderFooter(api)
        expect(screen.queryByText('https://provider.example/device?user_code=secret')).not.toBeInTheDocument()
        expect(getSessionOmpExtensionUiRequest).toHaveBeenCalledWith('session-1', 'request-1')

        await act(async () => response.resolve({
            success: true,
            input: {
                url: 'https://provider.example/device?user_code=secret',
                questions: [{
                    id: '__mcp_url_confirmation',
                    question: 'Enter the provider code',
                    required: true,
                    multiple: false,
                    options: [{
                        label: 'Open login page',
                        description: 'https://provider.example/device?user_code=secret'
                    }]
                }]
            }
        }))

        expect(await screen.findByText('Enter the provider code')).toBeInTheDocument()
        expect(screen.getByText('https://provider.example/device?user_code=secret')).toBeInTheDocument()
    })

    it('hydrates a transient editor prefill returned by the CLI', async () => {
        const api = {
            getSessionOmpExtensionUiRequest: vi.fn(async () => ({
                success: true as const,
                input: {
                    questions: [{
                        id: 'value',
                        question: 'Edit callback data',
                        required: false,
                        multiple: false,
                        options: [],
                        initialValue: 'provider-prefill',
                        multiline: true
                    }]
                }
            })),
            approvePermission: vi.fn()
        } as unknown as ApiClient

        renderFooter(api)

        expect(await screen.findByDisplayValue('provider-prefill')).toBeInTheDocument()
    })

    it('shows a recoverable error when transient input is no longer available', async () => {
        const api = {
            getSessionOmpExtensionUiRequest: vi.fn(async () => ({
                success: false as const,
                error: 'OMP extension UI request is no longer pending'
            })),
            approvePermission: vi.fn()
        } as unknown as ApiClient

        renderFooter(api)

        expect(await screen.findByText('OMP extension UI request is no longer pending')).toBeInTheDocument()
    })
})
