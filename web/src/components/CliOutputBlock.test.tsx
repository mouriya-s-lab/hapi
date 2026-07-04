import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { CliOutputBlock } from '@/components/CliOutputBlock'

describe('CliOutputBlock', () => {
    it('keeps interactive code controls outside the dialog trigger button', () => {
        render(
            <I18nProvider>
                <CliOutputBlock text={'<command-name>npm test</command-name><local-command-stdout>ok</local-command-stdout>'} />
            </I18nProvider>
        )

        const trigger = screen.getByRole('button', { name: /npm test/i })
        expect(trigger).toBeInTheDocument()

        // 复制按钮存在，但不能嵌套在触发详情的 button 里（无效 HTML）
        const copyButton = screen.getByTitle('Copy')
        expect(copyButton).toBeInTheDocument()
        expect(trigger.contains(copyButton)).toBe(false)
    })
})
