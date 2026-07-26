import { useState, type ReactNode } from 'react'
import { CodeBlock } from '@/components/CodeBlock'
import { cn } from '@/lib/utils'

function ChevronIcon(props: { open: boolean }) {
    return (
        <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('shrink-0 transition-transform duration-200', props.open ? 'rotate-90' : '')}
            aria-hidden="true"
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

/**
 * 会话流里的一行系统提示（模型切换、压缩、限流……）。
 *
 * `details` 有值时（normalizer 不认识的 payload / 事件）整行变成可点开的开关，展开才
 * 显示原始 JSON。这样新版 CLI 冒出没被建模的消息类型时，会话流里只多一行灰字，而不是
 * 糊上一整屏 JSON —— 同时排查问题的人还能点开看到原文。
 */
export function EventNotice(props: {
    icon?: string | null
    text: string
    details?: string | null
    trailing?: ReactNode
    className?: string
}) {
    const [open, setOpen] = useState(false)
    const details = props.details

    const line = (
        <span className="inline-flex items-center gap-1">
            {props.icon ? <span aria-hidden="true">{props.icon}</span> : null}
            <span>{props.text}</span>
            {props.trailing}
        </span>
    )

    if (!details) {
        return (
            <div className={cn('mx-auto w-fit max-w-[92%] px-2 text-center text-xs text-[var(--app-hint)] opacity-80', props.className)}>
                {line}
            </div>
        )
    }

    return (
        <div className={cn('mx-auto w-full max-w-[92%] px-2 text-xs text-[var(--app-hint)]', props.className)}>
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                className="mx-auto flex w-fit items-center gap-1 rounded-md px-1 text-center opacity-80 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
            >
                <ChevronIcon open={open} />
                {line}
            </button>
            {open ? (
                <div className="mt-2 text-left">
                    <CodeBlock code={details} language="json" collapseLongContent />
                </div>
            ) : null}
        </div>
    )
}
