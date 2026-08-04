import { useAuiState } from '@assistant-ui/react'
import { formatMessageTimestamp, formatMessageTimestampTitle } from '@/chat/presentation'
import { cn } from '@/lib/utils'

type MessageTimestampProps = {
    className?: string
}

export function MessageTimestamp(props: MessageTimestampProps) {
    const createdAt = useAuiState((s) => s.message.createdAt)

    return (
        <time
            dateTime={createdAt.toISOString()}
            title={formatMessageTimestampTitle(createdAt)}
            className={cn('tabular-nums', props.className)}
        >
            {formatMessageTimestamp(createdAt)}
        </time>
    )
}
