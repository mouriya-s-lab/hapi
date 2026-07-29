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

    it('keeps inactive Claude resume model controls selectable when inactive sends can resume', () => {
        const onModelChange = vi.fn()
        const onEffortChange = vi.fn()
        const onResumeWithSessionModelChange = vi.fn()

        renderInProviders(
            <HappyComposer
                agentFlavor="claude"
                active={false}
                allowSendWhenInactive
                model="sonnet"
                effort={null}
                resumeWithSessionModel={false}
                onModelChange={onModelChange}
                onEffortChange={onEffortChange}
                onResumeWithSessionModelChange={onResumeWithSessionModelChange}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        fireEvent.click(screen.getByRole('button', { name: 'Fable' }))
        expect(onModelChange).toHaveBeenCalledWith('fable')
        expect(onResumeWithSessionModelChange).toHaveBeenCalledWith(true)

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        fireEvent.click(screen.getByRole('button', { name: 'Max' }))
        expect(onEffortChange).toHaveBeenCalledWith('max')

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        fireEvent.click(screen.getByRole('checkbox', { name: /Use session model on resume/i }))
        expect(onResumeWithSessionModelChange).toHaveBeenCalledWith(true)
    })

    it('renders custom model as a radio row and enables resume when an inactive session selects it', () => {
        const onModelChange = vi.fn()
        const onResumeWithSessionModelChange = vi.fn()

        renderInProviders(
            <HappyComposer
                agentFlavor="claude"
                active={false}
                allowSendWhenInactive
                model="vendor-existing-model"
                resumeWithSessionModel={false}
                onModelChange={onModelChange}
                onResumeWithSessionModelChange={onResumeWithSessionModelChange}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        expect(screen.getByRole('radio', { name: /Custom model ID/i })).toHaveAttribute('aria-checked', 'true')

        const input = screen.getByTestId('custom-model-input')
        expect(input).toHaveValue('vendor-existing-model')
        fireEvent.change(input, { target: { value: '  vendor-next-model  ' } })
        fireEvent.keyDown(input, { key: 'Enter' })

        expect(onModelChange).toHaveBeenCalledWith('vendor-next-model')
        expect(onResumeWithSessionModelChange).toHaveBeenCalledWith(true)
    })

    it('uses the native OMP cycle callback for the model shortcut', () => {
        const onCycleModel = vi.fn()
        const onModelChange = vi.fn()
        renderInProviders(
            <HappyComposer
                agentFlavor="omp"
                active
                model="ollama/qwen3"
                availableModelOptions={[{ value: 'ollama/qwen3', label: 'Qwen 3 (ollama)' }]}
                onModelChange={onModelChange}
                onCycleModel={onCycleModel}
            />
        )

        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'm', ctrlKey: true })
        expect(onCycleModel).toHaveBeenCalledOnce()
        expect(onModelChange).not.toHaveBeenCalled()
    })

    it('shows native OMP thinking choices and the Claude-only boundary', () => {
        const onEffortChange = vi.fn()
        renderInProviders(
            <HappyComposer
                agentFlavor="omp"
                active
                model="ollama/qwen3"
                effort="auto"
                availableModelOptions={[{ value: 'ollama/qwen3', label: 'Qwen 3 (ollama)' }]}
                availableEffortOptions={[
                    { value: 'auto', name: 'auto' },
                    { value: 'low', name: 'low' },
                    { value: 'high', name: 'high' }
                ]}
                onModelChange={vi.fn()}
                onEffortChange={onEffortChange}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
        expect(screen.getByText(/Fallback model, custom\/append system prompts/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'high' }))
        expect(onEffortChange).toHaveBeenCalledWith('high')
    })
})
