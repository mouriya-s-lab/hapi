import { useEffect, useState, useSyncExternalStore } from 'react'
import { SpeakerIcon, StopIcon } from '@/components/icons'
import { useOptionalHappyChatContext } from '@/components/AssistantChat/context'
import { useTranslation } from '@/lib/use-translation'
import {
    getSpeakerError,
    getSpeakerPhase,
    isQwenSpeakerAvailable,
    speakSummary,
    stopSpeaking,
    subscribeSpeaker
} from '@/realtime/messageSummarySpeaker'

/**
 * Per-message "read a spoken summary aloud" button. Rendered next to Copy;
 * hidden entirely when the hub has no qwen-realtime voice backend configured.
 */
export function SpeakSummaryButton(props: { messageId: string; text: string }) {
    const ctx = useOptionalHappyChatContext()
    const { t } = useTranslation()
    const [available, setAvailable] = useState(false)
    const phase = useSyncExternalStore(subscribeSpeaker, () => getSpeakerPhase(props.messageId))
    const error = useSyncExternalStore(subscribeSpeaker, () => getSpeakerError(props.messageId))

    useEffect(() => {
        if (!ctx) return
        let cancelled = false
        void isQwenSpeakerAvailable(ctx.api).then((ok) => {
            if (!cancelled) setAvailable(ok)
        })
        return () => { cancelled = true }
    }, [ctx])

    if (!ctx || !available || !props.text) return null

    const busy = phase !== 'idle'
    const title = error
        ? `${t('voice.readAloud')}: ${error}`
        : busy ? t('voice.readAloudStop') : t('voice.readAloud')

    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            className="p-0.5 rounded hover:bg-[var(--app-subtle-bg)] transition-colors"
            onClick={() => {
                if (busy) {
                    stopSpeaking()
                } else {
                    void speakSummary(ctx.api, props.messageId, props.text)
                }
            }}
        >
            {phase === 'speaking'
                ? <StopIcon className="h-3.5 w-3.5 text-[var(--app-accent,#3b82f6)]" />
                : (
                    <SpeakerIcon
                        className={`h-3.5 w-3.5 ${phase === 'loading'
                            ? 'animate-pulse text-[var(--app-accent,#3b82f6)]'
                            : error ? 'text-red-500' : 'text-[var(--app-hint)]'}`}
                    />
                )}
        </button>
    )
}
