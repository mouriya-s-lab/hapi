import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { ToastProvider } from '@/lib/toast-context'
import { RenameSessionDialog } from './RenameSessionDialog'
import { SessionExportDialog } from './SessionExportDialog'
import { UriConfirmDialog } from './UriConfirmDialog'

function renderWithProviders(content: React.ReactNode) {
    return render(
        <I18nProvider>
            <ToastProvider>{content}</ToastProvider>
        </I18nProvider>
    )
}

function expectCenteredTitle(name: string) {
    const dialog = screen.getByRole('dialog')
    const title = within(dialog).getByRole('heading', { name })

    expect(title.parentElement).toHaveClass('pr-0')
    expect(title).toHaveClass('min-h-6', 'px-10', 'text-center', 'leading-6')
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveClass('top-3', 'h-8')
}

describe('session dialog title alignment', () => {
    it('centers the rename dialog title on the close button centerline', () => {
        renderWithProviders(
            <RenameSessionDialog
                isOpen={true}
                onClose={vi.fn()}
                currentName="Session"
                onRename={vi.fn(async () => {})}
                isPending={false}
            />
        )

        expectCenteredTitle('Rename Session')
    })

    it('centers the export dialog title on the close button centerline', () => {
        renderWithProviders(
            <SessionExportDialog
                isOpen={true}
                onClose={vi.fn()}
                sessionId="session-1"
                api={null}
            />
        )

        expectCenteredTitle('Export conversation')
    })

    it('centers the external-link dialog title on the close button centerline', () => {
        renderWithProviders(
            <UriConfirmDialog
                open={true}
                url="obsidian://open"
                scheme="obsidian"
                onCancel={vi.fn()}
                onOpen={vi.fn()}
                onAlwaysAllow={vi.fn()}
            />
        )

        expectCenteredTitle('Open this link?')
    })
})
