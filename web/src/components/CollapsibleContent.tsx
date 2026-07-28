import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

const DEFAULT_CHAR_THRESHOLD = 2000
const DEFAULT_LINE_THRESHOLD = 24
const DEFAULT_COLLAPSED_HEIGHT = 280

function countLines(text: string): number {
    if (text.length === 0) return 1
    return text.split('\n').length
}

function exceedsCollapseThreshold(text: string, charThreshold: number, lineThreshold: number): boolean {
    return text.length > charThreshold || countLines(text) > lineThreshold
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
            className={cn('shrink-0 transition-transform duration-200', props.open && 'rotate-90')}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

export function CollapsibleContent(props: {
    text: string
    children: ReactNode
    surfaceVar?: string
    collapsedHeight?: number
    charThreshold?: number
    lineThreshold?: number
}) {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const collapsible = exceedsCollapseThreshold(
        props.text,
        props.charThreshold ?? DEFAULT_CHAR_THRESHOLD,
        props.lineThreshold ?? DEFAULT_LINE_THRESHOLD
    )

    if (!collapsible) return <>{props.children}</>

    const surface = `var(${props.surfaceVar ?? '--app-bg'})`
    const toggle = (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        setExpanded((current) => {
            if (current) requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: 'nearest' }))
            return !current
        })
    }

    if (!expanded) {
        return (
            <div ref={rootRef} className="relative min-w-0">
                <div style={{ maxHeight: props.collapsedHeight ?? DEFAULT_COLLAPSED_HEIGHT, overflowY: 'hidden' }}>
                    {props.children}
                </div>
                <div
                    className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-2 pb-1 pt-12"
                    style={{ backgroundImage: `linear-gradient(to top, ${surface}, color-mix(in srgb, ${surface} 88%, transparent) 55%, transparent)` }}
                >
                    <button
                        type="button"
                        onClick={toggle}
                        className="pointer-events-auto inline-flex cursor-pointer items-center gap-1 rounded-full bg-[var(--app-chat-user-chip-bg)] px-2.5 py-0.5 text-[11px] text-[var(--app-hint)] transition-colors hover:text-[var(--app-fg)]"
                    >
                        <ChevronIcon open={false} />
                        {t('collapse.expandLines', { n: countLines(props.text) })}
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div ref={rootRef} className="min-w-0">
            <button
                type="button"
                onClick={toggle}
                className="sticky top-0 z-10 flex w-full cursor-pointer select-none items-center gap-1.5 py-1 text-left text-[11px] text-[var(--app-hint)] transition-colors hover:text-[var(--app-fg)]"
                style={{ backgroundColor: surface }}
            >
                <ChevronIcon open />
                <span>{t('collapse.collapse')}</span>
            </button>
            {props.children}
        </div>
    )
}
