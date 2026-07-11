import { useEffect, useState } from 'react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { usePlatform } from '@/hooks/usePlatform'
import { usePwaUpdateContext } from '@/lib/pwa-update-context'
import { useTranslation } from '@/lib/use-translation'
import { useVoiceOptional } from '@/lib/voice-context'

interface ChangelogEntry {
    hash: string
    date: string
    subject: string
}

const MAX_VISIBLE_CHANGES = 6

/**
 * Fetch the NEW build's changelog.json (served by the already-updated hub,
 * cache-busted past the old service worker) and keep only entries newer than
 * the commit this page was built from.
 */
function useIncomingChanges(needRefresh: boolean): ChangelogEntry[] | null {
    const [changes, setChanges] = useState<ChangelogEntry[] | null>(null)

    useEffect(() => {
        if (!needRefresh) return
        let cancelled = false
        const url = `${import.meta.env.BASE_URL}changelog.json?ts=${Date.now()}`
        fetch(url, { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { commit?: string; entries?: ChangelogEntry[] } | null) => {
                if (cancelled || !Array.isArray(data?.entries)) return
                const mine = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : ''
                const idx = data.entries.findIndex((e) => e.hash === mine)
                // idx === -1: this page's commit is deeper than the log window — show all we have.
                // idx === 0: same commit (rebuild only) — nothing user-visible to list.
                setChanges(idx === -1 ? data.entries : data.entries.slice(0, idx))
            })
            .catch(() => { /* changelog is best-effort — banner still works without it */ })
        return () => { cancelled = true }
    }, [needRefresh])

    return changes
}

export function PwaUpdateBanner({ topClassName }: { topClassName?: string } = {}) {
    const { t } = useTranslation()
    const { needRefresh, reload } = usePwaUpdateContext()
    const isOnline = useOnlineStatus()
    const { haptic } = usePlatform()
    const changes = useIncomingChanges(needRefresh)

    if (!needRefresh) {
        return null
    }

    const topClass = topClassName ?? (isOnline
        ? 'top-[calc(env(safe-area-inset-top)+0.5rem)]'
        : 'top-[calc(env(safe-area-inset-top)+2.5rem)]')
    const hiddenCount = changes ? Math.max(0, changes.length - MAX_VISIBLE_CHANGES) : 0

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

            {changes && changes.length > 0 && (
                <div className="mt-3 border-t border-[var(--app-border)] pt-2">
                    <p className="text-xs font-medium text-[var(--app-fg)]">
                        {t('pwa.update.changes')}
                    </p>
                    <ul className="mt-1.5 space-y-1 max-h-36 overflow-y-auto text-xs text-[var(--app-hint)] leading-relaxed">
                        {changes.slice(0, MAX_VISIBLE_CHANGES).map((c) => (
                            <li key={c.hash} className="flex gap-1.5 min-w-0">
                                <span className="shrink-0 select-none">•</span>
                                <span className="min-w-0 break-words">{c.subject}</span>
                            </li>
                        ))}
                        {hiddenCount > 0 && (
                            <li className="text-[var(--app-hint)] opacity-70">
                                {t('pwa.update.changesMore', { count: hiddenCount })}
                            </li>
                        )}
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
