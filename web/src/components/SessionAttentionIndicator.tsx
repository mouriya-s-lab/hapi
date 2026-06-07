import type { SessionAttention } from '@/lib/sessionAttention'
import { getSessionAttentionLabelKey } from '@/lib/sessionAttention'

const ATTENTION_DOT_CLASS: Record<SessionAttention['kind'], string> = {
    permission: 'bg-amber-500 animate-pulse',
    input: 'bg-blue-500',
    background: 'bg-blue-400',
    ready: 'bg-blue-500',
    unread: 'bg-[var(--app-link)]'
}

export function SessionAttentionIndicator(props: {
    attention: SessionAttention
    label: string
}) {
    return (
        <span
            data-attention={props.attention.kind}
            className={`inline-flex h-2 w-2 shrink-0 rounded-full ${ATTENTION_DOT_CLASS[props.attention.kind]}`}
            title={props.label}
            aria-label={props.label}
        />
    )
}

export function getAttentionLabel(
    attention: SessionAttention,
    t: (key: string) => string
): string {
    return t(getSessionAttentionLabelKey(attention))
}
