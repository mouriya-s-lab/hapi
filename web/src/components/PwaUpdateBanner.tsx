import { useEffect, useState } from 'react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { usePlatform } from '@/hooks/usePlatform'
import { usePwaUpdateContext } from '@/lib/pwa-update-context'
import { useTranslation } from '@/lib/use-translation'
import { useVoiceOptional } from '@/lib/voice-context'
import { selectIncomingChanges, type IncomingChanges } from '@/lib/changelog'

function useIncomingChanges(needRefresh: boolean): IncomingChanges {
    const [result, setResult] = useState<IncomingChanges>({ status: 'idle' })

    useEffect(() => {
        if (!needRefresh) {
            setResult({ status: 'idle' })
            return
        }

        const controller = new AbortController()
        setResult({ status: 'loading' })

        void fetch(`${import.meta.env.BASE_URL}changelog.json?commit=${encodeURIComponent(__APP_COMMIT__)}`, {
            cache: 'no-store',
            signal: controller.signal,
        })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Changelog request failed with HTTP ${response.status}`)
                }
                return response.json()
            })
            .then((payload: unknown) => {
                setResult({ status: 'ready', entries: selectIncomingChanges(payload, __APP_COMMIT__) })
            })
            .catch((error: unknown) => {
                if (error instanceof DOMException && error.name === 'AbortError') {
                    return
                }
                setResult({ status: 'error' })
            })

        return () => controller.abort()
    }, [needRefresh])

    return result
}

export function PwaUpdateBanner({ topClassName }: { topClassName?: string } = {}) {
    const { t } = useTranslation()
    const { needRefresh, reload } = usePwaUpdateContext()
    const isOnline = useOnlineStatus()
    const { haptic } = usePlatform()
    const incomingChanges = useIncomingChanges(needRefresh)

    if (!needRefresh) {
        return null
    }

    const topClass = topClassName ?? (isOnline
        ? 'top-[calc(env(safe-area-inset-top)+0.5rem)]'
        : 'top-[calc(env(safe-area-inset-top)+2.5rem)]')

    return (
        <div
            data-testid="pwa-update-banner"
            className={`fixed left-4 right-4 bg-[var(--app-secondary-bg)] border border-[var(--app-border)] rounded-lg p-4 shadow-lg z-50 ${topClass}`}
        >
            <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--app-fg)]">
                        {t('pwa.update.title')}
                    </p>
                    <p className="text-xs text-[var(--app-hint)] mt-0.5">
                        {t('pwa.update.body')}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        haptic.impact('light')
                        reload()
                    }}
                    className="shrink-0 px-4 py-2 bg-[var(--app-fg)] text-[var(--app-bg)] rounded-lg text-sm font-medium active:opacity-80"
                >
                    {t('pwa.update.reload')}
                </button>
            </div>

            {incomingChanges.status === 'loading' && (
                <p className="mt-3 border-t border-[var(--app-border)] pt-2 text-xs text-[var(--app-hint)]">
                    {t('pwa.update.changesLoading')}
                </p>
            )}

            {incomingChanges.status === 'error' && (
                <p role="status" className="mt-3 border-t border-[var(--app-border)] pt-2 text-xs text-[var(--app-hint)]">
                    {t('pwa.update.changesFailed')}
                </p>
            )}

            {incomingChanges.status === 'ready' && incomingChanges.entries.length > 0 && (
                <div className="mt-3 border-t border-[var(--app-border)] pt-2">
                    <p className="text-xs font-medium text-[var(--app-fg)]">
                        {t('pwa.update.changes')}
                    </p>
                    <ul className="mt-1.5 max-h-36 space-y-1 overflow-y-auto text-xs leading-relaxed text-[var(--app-hint)]">
                        {incomingChanges.entries.map((entry) => (
                            <li key={entry.hash} className="flex min-w-0 gap-1.5">
                                <span className="shrink-0 select-none">•</span>
                                <span className="min-w-0 break-words">{entry.subject}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <details className="mt-3 border-t border-[var(--app-border)] pt-2">
                <summary className="cursor-pointer text-xs text-[var(--app-link)] active:opacity-60 list-none [&::-webkit-details-marker]:hidden">
                    {t('pwa.update.whyToggle')}
                </summary>
                <p className="mt-2 text-xs text-[var(--app-hint)] leading-relaxed">
                    {t('pwa.update.whyBody')}
                </p>
            </details>
        </div>
    )
}

export function PwaUpdateBannerWithStatusOffset({
    isSyncing,
    isReconnecting,
}: {
    isSyncing: boolean
    isReconnecting: boolean
}) {
    const voice = useVoiceOptional()
    const hasTopStatusBanner =
        isSyncing ||
        isReconnecting ||
        Boolean(voice && voice.status === 'error' && voice.errorMessage)

    return (
        <PwaUpdateBanner
            topClassName={hasTopStatusBanner
                ? 'top-[calc(env(safe-area-inset-top)+3rem)]'
                : undefined}
        />
    )
}
