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

function shouldCollapse(text: string, charThreshold: number, lineThreshold: number): boolean {
    if (text.length > charThreshold) return true
    return countLines(text) > lineThreshold
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
            className={cn('shrink-0 transition-transform duration-200', props.open ? 'rotate-90' : '')}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

/**
 * 通用的超长内容折叠器：内容超过阈值时默认裁剪为固定高度并提供“展开全部”按钮；
 * 展开后在顶部提供 sticky 的折叠手柄，滚到内容任意位置都能一键折叠，
 * 无需滚回消息顶端（与 reasoning.tsx 的手柄同一套交互）。
 *
 * sticky 依赖祖先链上没有 overflow(-x): hidden/auto/scroll 的元素
 * （它们会成为 sticky 的滚动上下文）——消息层的裁剪一律用 overflow-clip。
 *
 * surfaceVar 是所在卡片/气泡的背景色 CSS 变量名，用于 sticky 手柄底色
 * 和裁剪处的渐隐遮罩（Tailwind 无法编译动态任意值，所以用内联样式）。
 */
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

    const collapsible = shouldCollapse(
        props.text,
        props.charThreshold ?? DEFAULT_CHAR_THRESHOLD,
        props.lineThreshold ?? DEFAULT_LINE_THRESHOLD
    )

    if (!collapsible) {
        return <>{props.children}</>
    }

    const surface = `var(${props.surfaceVar ?? '--app-bg'})`
    const collapsedHeight = props.collapsedHeight ?? DEFAULT_COLLAPSED_HEIGHT

    const toggle = (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        setExpanded((value) => {
            // 折叠后消息高度骤减，把区块拉回视口，避免滚动位置落到不相关内容上
            if (value) {
                requestAnimationFrame(() => rootRef.current?.scrollIntoView?.({ block: 'nearest' }))
            }
            return !value
        })
    }

    if (!expanded) {
        return (
            <div ref={rootRef} className="relative min-w-0">
                <div style={{ maxHeight: collapsedHeight, overflowY: 'hidden' }}>
                    {props.children}
                </div>
                <div
                    className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-2 pb-1 pt-12"
                    style={{ backgroundImage: `linear-gradient(to top, ${surface}, color-mix(in srgb, ${surface} 88%, transparent) 55%, transparent)` }}
                >
                    <button
                        type="button"
                        onClick={toggle}
                        className="pointer-events-auto inline-flex cursor-pointer items-center gap-1 rounded-full bg-[var(--app-chat-user-chip-bg)] px-2.5 py-0.5 text-[11px] text-[var(--app-hint)] shadow-none transition-colors hover:text-[var(--app-fg)]"
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
                <ChevronIcon open={true} />
                <span>{t('collapse.collapse')}</span>
            </button>
            {props.children}
        </div>
    )
}
