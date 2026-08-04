import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SelectControl } from './select-control'

describe('SelectControl', () => {
    it('replaces the native arrow with an inset decorative chevron', () => {
        render(
            <SelectControl aria-label="Machine" defaultValue="local">
                <option value="local">Local</option>
            </SelectControl>
        )

        const select = screen.getByRole('combobox', { name: 'Machine' })
        const chevron = select.nextElementSibling

        expect(select).toHaveClass('appearance-none', 'pr-10')
        expect(chevron).toHaveAttribute('aria-hidden', 'true')
        expect(chevron).toHaveClass('pointer-events-none', 'right-3')
    })

    it('preserves native select behavior and wrapper sizing classes', () => {
        const onChange = vi.fn()

        render(
            <SelectControl
                aria-label="Language"
                containerClassName="max-w-[55%]"
                defaultValue="en"
                onChange={onChange}
            >
                <option value="en">English</option>
                <option value="zh">Chinese</option>
            </SelectControl>
        )

        const select = screen.getByRole('combobox', { name: 'Language' })
        expect(select.parentElement).toHaveClass('max-w-[55%]')

        fireEvent.change(select, { target: { value: 'zh' } })
        expect(onChange).toHaveBeenCalledOnce()
        expect(select).toHaveValue('zh')
    })
})
