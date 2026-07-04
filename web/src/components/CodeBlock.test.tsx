import { describe, expect, it } from 'vitest'
import { fireEvent, render, within } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { CodeBlock } from '@/components/CodeBlock'

function renderCodeBlock(code: string, props: Partial<Parameters<typeof CodeBlock>[0]> = {}) {
    const { container } = render(
        <I18nProvider>
            <CodeBlock code={code} {...props} />
        </I18nProvider>
    )
    return { container, scope: within(container) }
}

describe('CodeBlock', () => {
    it('renders a header label and expand toggle for long content', () => {
        const longCode = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n')
        const { container, scope } = renderCodeBlock(longCode, {
            language: 'typescript',
            title: 'TypeScript',
            collapseLongContent: true,
            collapseLineThreshold: 5
        })

        expect(scope.getByText('TypeScript')).toBeInTheDocument()
        expect(scope.getByTitle('Copy')).toBeInTheDocument()
        expect(scope.getByText('Show all (40 lines)')).toBeInTheDocument()
        expect(container.querySelector('[style*="grid-template-columns: 3ch max-content"]')).not.toBeNull()
        expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent(/^1 2 3/)
    })

    it('expands and collapses long content in place', () => {
        const longCode = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n')
        const { scope } = renderCodeBlock(longCode, {
            collapseLongContent: true,
            collapseLineThreshold: 5
        })

        fireEvent.click(scope.getByText('Show all (40 lines)'))
        expect(scope.queryByText('Show all (40 lines)')).not.toBeInTheDocument()

        // 展开后表头变成可点击的折叠按钮
        fireEvent.click(scope.getByTitle('Collapse'))
        expect(scope.getByText('Show all (40 lines)')).toBeInTheDocument()
    })

    it('does not render a toggle for short content', () => {
        const { scope } = renderCodeBlock('one\ntwo', { collapseLongContent: true })

        expect(scope.queryByText(/Show all/)).not.toBeInTheDocument()
        expect(scope.queryByTitle('Expand')).not.toBeInTheDocument()
    })
})
