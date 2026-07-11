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
        const copyButton = screen.getByTitle('Copy')
        expect(trigger.contains(copyButton)).toBe(false)
    })
})
