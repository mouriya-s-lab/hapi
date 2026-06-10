import type { ReactElement, TextareaHTMLAttributes } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { HappyComposer } from './HappyComposer'

vi.mock('@/components/AssistantChat/ComposerButtons', () => ({
    ComposerButtons: (props: { showSettingsButton: boolean; onSettingsToggle: () => void }) => (
        props.showSettingsButton ? (
            <button type="button" aria-label="Settings" onClick={props.onSettingsToggle}>
                Settings
            </button>
        ) : null
    )
}))

vi.mock('@assistant-ui/react', async () => {
    const React = await import('react')
    return {
        useAssistantApi: () => ({
            composer: () => ({
                send: vi.fn(),
                setText: vi.fn()
            })
        }),
        useAssistantState: (selector: (state: unknown) => unknown) => selector({
            composer: {
                text: '',
                attachments: []
            },
            thread: {
                isRunning: false,
                isDisabled: false
            }
        }),
        ComposerPrimitive: {
            Root: ({ children, ...props }: { children: React.ReactNode }) => <form {...props}>{children}</form>,
            Attachments: () => null,
            Input: React.forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & {
                maxRows?: number
                submitOnEnter?: boolean
                cancelOnEscape?: boolean
            }>((props, ref) => {
                const { maxRows: _maxRows, submitOnEnter: _submitOnEnter, cancelOnEscape: _cancelOnEscape, ...textareaProps } = props
                return <textarea ref={ref} {...textareaProps} />
            })
        }
    }
})

function renderInProviders(ui: ReactElement) {
    return render(<I18nProvider>{ui}</I18nProvider>)
}

describe('HappyComposer resume model setting', () => {
    afterEach(() => {
        cleanup()
    })

    it('renders a Claude session-scoped resume model checkbox and toggles it', () => {
        const onResumeWithSessionModelChange = vi.fn()

        renderInProviders(
            <HappyComposer
                agentFlavor="claude"
                active
                model="sonnet"
                effort="high"
                resumeWithSessionModel={false}
                onModelChange={vi.fn()}
                onResumeWithSessionModelChange={onResumeWithSessionModelChange}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        const checkbox = screen.getByRole('checkbox', { name: /Use session model on resume/i })
        expect(checkbox).toHaveAttribute('aria-checked', 'false')

        fireEvent.click(checkbox)
        expect(onResumeWithSessionModelChange).toHaveBeenCalledWith(true)
    })

    it('reflects checked state from the current session props', () => {
        renderInProviders(
            <HappyComposer
                agentFlavor="claude"
                active
                model="sonnet"
                resumeWithSessionModel
                onModelChange={vi.fn()}
                onResumeWithSessionModelChange={vi.fn()}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        expect(screen.getByRole('checkbox', { name: /Use session model on resume/i })).toHaveAttribute('aria-checked', 'true')
    })

    it('does not render the resume model checkbox for non-Claude sessions', () => {
        renderInProviders(
            <HappyComposer
                agentFlavor="codex"
                active
                model="gpt-5.4"
                resumeWithSessionModel
                onModelChange={vi.fn()}
                onResumeWithSessionModelChange={vi.fn()}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        expect(screen.queryByRole('checkbox', { name: /Use session model on resume/i })).toBeNull()
    })
})
