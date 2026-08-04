import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DirectorySection } from './DirectorySection'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}))

describe('DirectorySection', () => {
    it('stretches the Browse button to the directory input height', () => {
        render(
            <DirectorySection
                directory=""
                suggestions={[]}
                selectedIndex={0}
                isDisabled={false}
                recentPaths={[]}
                onDirectoryChange={vi.fn()}
                onDirectoryFocus={vi.fn()}
                onDirectoryBlur={vi.fn()}
                onDirectoryKeyDown={vi.fn()}
                onSuggestionSelect={vi.fn()}
                onPathClick={vi.fn()}
                onChooseFolder={vi.fn()}
            />
        )

        expect(screen.getByRole('button', { name: 'newSession.browse' })).toHaveClass('self-stretch')
    })
})
