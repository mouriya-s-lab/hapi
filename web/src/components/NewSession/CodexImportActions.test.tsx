import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodexImportActions } from './CodexImportActions'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

describe('CodexImportActions', () => {
    it('exposes one Codex history entry point', () => {
        const onChooseHistory = vi.fn()

        render(
            <CodexImportActions
                selectedSession={null}
                isLoading={false}
                isDisabled={false}
                error={null}
                onChooseHistory={onChooseHistory}
                onClear={vi.fn()}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'codexSync.newSessionInline.choose' }))

        expect(onChooseHistory).toHaveBeenCalledOnce()
        expect(screen.getAllByRole('button')).toHaveLength(1)
    })

    it('disables the import entry point while sessions are loading', () => {
        render(
            <CodexImportActions
                selectedSession={null}
                isLoading={true}
                isDisabled={false}
                error={null}
                onChooseHistory={vi.fn()}
                onClear={vi.fn()}
            />
        )

        expect(screen.getByRole('button', { name: 'codexSync.confirm.loading' })).toBeDisabled()
    })
})
