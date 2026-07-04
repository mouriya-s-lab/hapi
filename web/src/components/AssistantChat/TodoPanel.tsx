import { useMemo, useState } from 'react'
import { ChecklistList, extractTodoChecklist } from '@/components/ToolCard/checklist'
import { useTranslation } from '@/lib/use-translation'

const COLLAPSED_STORAGE_KEY = 'hapi-todo-panel-collapsed'

function readCollapsedPreference(): boolean {
    try {
        return localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1'
    } catch {
        return false
    }
}

function persistCollapsedPreference(collapsed: boolean): void {
    try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0')
    } catch {
        // storage unavailable — preference just won't persist
    }
}

function ChevronIcon(props: { open: boolean }) {
    return (
        <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 transition-transform duration-200 ${props.open ? 'rotate-90' : ''}`}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function TodoIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-[var(--app-hint)]"
        >
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
    )
}

/**
 * Composer 上方的任务清单面板：实时显示 session.todos（hub 从 TodoWrite/
 * update_plan/ACP plan 提取维护），按完成状态打勾，可折叠。折叠偏好全局
 * 记忆在 localStorage；收起时头部显示当前进行中的任务，随时可瞟一眼进度。
 */
export function TodoPanel(props: { sessionId: string; todos: unknown }) {
    const { t } = useTranslation()
    const [collapsed, setCollapsed] = useState(readCollapsedPreference)

    const items = useMemo(
        () => extractTodoChecklist({ todos: props.todos }, null),
        [props.todos]
    )

    const completed = useMemo(
        () => items.filter((item) => item.status === 'completed').length,
        [items]
    )
    const inProgress = useMemo(
        () => items.find((item) => item.status === 'in_progress') ?? null,
        [items]
    )

    if (items.length === 0) return null

    const toggleCollapsed = () => {
        setCollapsed((prev) => {
            const next = !prev
            persistCollapsedPreference(next)
            return next
        })
    }

    return (
        <div className="mx-auto w-full max-w-content mb-1">
            <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-subtle-bg)]" data-testid="todo-panel">
                <button
                    type="button"
                    onClick={toggleCollapsed}
                    aria-expanded={!collapsed}
                    aria-controls={`todo-panel-body-${props.sessionId}`}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-[var(--app-fg)] hover:opacity-90"
                >
                    <ChevronIcon open={!collapsed} />
                    <TodoIcon />
                    <span className="shrink-0">{t('todoPanel.title')}</span>
                    {collapsed && inProgress ? (
                        <span className="min-w-0 flex-1 truncate font-normal text-[var(--app-link)]">
                            ◉ {inProgress.text}
                        </span>
                    ) : (
                        <span className="flex-1" />
                    )}
                    <span className="shrink-0 text-[11px] tabular-nums text-[var(--app-hint)]">
                        {completed}/{items.length}
                    </span>
                </button>

                <div
                    id={`todo-panel-body-${props.sessionId}`}
                    className="collapsible-panel"
                    aria-hidden={collapsed}
                    {...(!collapsed ? { 'data-open': '' } : {})}
                >
                    <div className="collapsible-inner" inert={collapsed}>
                        <div className="max-h-44 overflow-y-auto px-3 pb-2">
                            <ChecklistList items={items} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
