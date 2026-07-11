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

export function SpeakSummaryButton(props: { messageId: string; text: string }) {
    const ctx = useOptionalHappyChatContext()
    const { t } = useTranslation()
    const [available, setAvailable] = useState(false)
    const phase = useSyncExternalStore(subscribeSpeaker, () => getSpeakerPhase(props.messageId))
    const error = useSyncExternalStore(subscribeSpeaker, () => getSpeakerError(props.messageId))

    useEffect(() => {
        if (!ctx) return
        let active = true
        void isQwenSpeakerAvailable(ctx.api).then((value) => {
            if (active) setAvailable(value)
        }).catch((error: unknown) => {
            console.error('[SpeakSummary] Voice backend discovery failed:', error)
        })
        return () => { active = false }
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
            onClick={() => busy ? stopSpeaking() : void speakSummary(ctx.api, props.messageId, props.text)}
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
