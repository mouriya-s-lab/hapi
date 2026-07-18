import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { SessionIdDialog } from './SessionIdDialog'
import type { Session } from '@/types/api'

const copySpy = vi.fn(async (_text: string) => {})
vi.mock('@/lib/clipboard', () => ({
    safeCopyToClipboard: (text: string) => copySpy(text),
}))

function makeSession(metadata: Record<string, unknown> | null): Session {
    return {
        id: 'session-1',
        active: true,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: metadata === null ? null : { path: '/p', host: 'h', ...metadata },
    } as Session
}

describe('SessionIdDialog', () => {
    afterEach(() => {
        cleanup()
        copySpy.mockClear()
    })

    it('shows the resume-able session id in a read-only input', () => {
        render(
            <I18nProvider>
                <SessionIdDialog
                    isOpen
                    onClose={vi.fn()}
                    session={makeSession({
                        flavor: 'omp',
                        ompSession: { id: 'omp-thread-9', file: '/sessions/omp-thread-9.jsonl' }
                    })}
                />
            </I18nProvider>
        )
        const input = screen.getByTestId('session-id-input') as HTMLInputElement
        expect(input.value).toBe('omp-thread-9')
        expect(input.readOnly).toBe(true)
    })

    it('copies the session id via the copy button', async () => {
        render(
            <I18nProvider>
                <SessionIdDialog
                    isOpen
                    onClose={vi.fn()}
                    session={makeSession({ flavor: 'opencode', opencodeSessionId: 'oc-1' })}
                />
            </I18nProvider>
        )
        fireEvent.click(screen.getByTestId('session-id-copy'))
        await waitFor(() => expect(copySpy).toHaveBeenCalledWith('oc-1'))
    })

    it('shows an empty state when there is no resume-able id', () => {
        render(
            <I18nProvider>
                <SessionIdDialog
                    isOpen
                    onClose={vi.fn()}
                    session={makeSession({ flavor: 'omp' })}
                />
            </I18nProvider>
        )
        expect(screen.getByTestId('session-id-empty')).toBeInTheDocument()
        expect(screen.queryByTestId('session-id-input')).not.toBeInTheDocument()
    })
})
