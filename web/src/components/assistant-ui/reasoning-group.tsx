import { useEffect, useState, type FC, type PropsWithChildren } from 'react'
import { useMessage } from '@assistant-ui/react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

function ChevronIcon(props: { open: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('transition-transform duration-200', props.open ? 'rotate-90' : '')}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function ShimmerDot() {
    return <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
}

type ReasoningGroupViewProps = PropsWithChildren<{
    isOpen: boolean
    isStreaming: boolean
    onToggle: () => void
}>

export const ReasoningGroupView: FC<ReasoningGroupViewProps> = ({ children, isOpen, isStreaming, onToggle }) => {
    const { t } = useTranslation()

    return (
        <div className="aui-reasoning-group my-3 rounded-2xl bg-[var(--app-reasoning-bg)]">
            <button
                type="button"
                onClick={onToggle}
                className={cn(
                    'sticky top-0 z-10 flex w-full items-center gap-1.5 px-3.5 py-2.5 text-left text-xs font-medium',
                    'bg-[var(--app-reasoning-bg)] text-[var(--app-hint)] hover:text-[var(--app-fg)]',
                    'transition-colors cursor-pointer select-none',
                    isOpen ? 'rounded-t-2xl' : 'rounded-2xl'
                )}
            >
                <ChevronIcon open={isOpen} />
                <span>Reasoning</span>
                {isStreaming && (
                    <span className="ml-1 flex items-center gap-1 text-[var(--app-hint)]">
                        <ShimmerDot />
                    </span>
                )}
                {isOpen && (
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-[var(--app-hint)] opacity-60">
                        {t('reasoning.collapseHint')}
                    </span>
                )}
            </button>

            <div
                className={cn(
                    'overflow-hidden rounded-b-2xl transition-all duration-200 ease-in-out',
                    isOpen ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'
                )}
            >
                <div className="border-t border-[var(--app-divider)] px-3.5 py-3">{children}</div>
            </div>
        </div>
    )
}

export const ReasoningGroup: FC<PropsWithChildren> = ({ children }) => {
    const [isOpen, setIsOpen] = useState(false)
    const message = useMessage()
    const isStreaming = message.status?.type === 'running'
        && message.content.length > 0
        && message.content[message.content.length - 1]?.type === 'reasoning'

    useEffect(() => {
        if (isStreaming) setIsOpen(true)
    }, [isStreaming])

    return (
        <ReasoningGroupView
            isOpen={isOpen}
            isStreaming={isStreaming}
            onToggle={() => setIsOpen((open) => !open)}
        >
            {children}
        </ReasoningGroupView>
    )
}
