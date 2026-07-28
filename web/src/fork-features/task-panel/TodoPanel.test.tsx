import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import type { TodoItem } from '@hapi/protocol/types'
import { TodoPanel } from './TodoPanel'

function renderPanel(todos: TodoItem[]) {
    return render(
        <I18nProvider>
            <TodoPanel sessionId="session-117" todos={todos} />
        </I18nProvider>
    )
}

beforeEach(() => localStorage.clear())

describe('TodoPanel', () => {
    it('does not render without tasks', () => {
        renderPanel([])
        expect(screen.queryByTestId('todo-panel')).toBeNull()
    })

    it('shows task state and progress above the composer', () => {
        renderPanel([
            { id: '1', content: '分析来源', status: 'completed', priority: 'medium' },
            { id: '2', content: '重新实现', status: 'in_progress', priority: 'medium' }
        ])
        expect(screen.getByTestId('todo-panel')).toHaveTextContent('分析来源')
        expect(screen.getByTestId('todo-panel')).toHaveTextContent('重新实现')
        expect(screen.getByText('1/2')).toBeInTheDocument()
    })

    it('persists collapse state and exposes the active task in the header', () => {
        const todos: TodoItem[] = [{ id: '2', content: '运行 smoke', status: 'in_progress', priority: 'medium' }]
        const first = renderPanel(todos)
        const toggle = screen.getByRole('button', { name: /Tasks/ })
        fireEvent.click(toggle)
        expect(toggle).toHaveAttribute('aria-expanded', 'false')
        expect(toggle).toHaveTextContent('运行 smoke')
        first.unmount()

        renderPanel(todos)
        expect(screen.getByRole('button', { name: /Tasks/ })).toHaveAttribute('aria-expanded', 'false')
    })

    it('renders only the currently selected session projection', () => {
        const firstSession: TodoItem[] = [
            { id: '1', content: '仅属于 session A', status: 'in_progress', priority: 'medium' }
        ]
        const view = renderPanel(firstSession)
        expect(screen.getByTestId('todo-panel')).toHaveTextContent('仅属于 session A')

        view.rerender(
            <I18nProvider>
                <TodoPanel sessionId="session-B" todos={[]} />
            </I18nProvider>
        )
        expect(screen.queryByTestId('todo-panel')).toBeNull()

        view.rerender(
            <I18nProvider>
                <TodoPanel sessionId="session-A" todos={firstSession} />
            </I18nProvider>
        )
        expect(screen.getAllByTestId('todo-panel')).toHaveLength(1)
        expect(screen.getByTestId('todo-panel')).toHaveTextContent('仅属于 session A')
    })
})
