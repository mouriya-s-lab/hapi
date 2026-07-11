import { useEffect, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { ImportableSessionAgent, ImportableSessionsResponse } from '@hapi/protocol/apiTypes'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'
import { useTranslation } from '@/lib/use-translation'

export function ImportExistingSessionsDialog(props: {
    api: ApiClient
    machineId: string
    onClose: () => void
    onImported: (sessionId: string) => void
}) {
    const { t } = useTranslation()
    const [agent, setAgent] = useState<ImportableSessionAgent>('claude')
    const [results, setResults] = useState<Partial<Record<ImportableSessionAgent, ImportableSessionsResponse>>>({})
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [importing, setImporting] = useState<string | null>(null)
    const [loadingMore, setLoadingMore] = useState(false)

    useEffect(() => {
        if (results[agent]) return
        let active = true
        setLoading(true)
        setError(null)
        props.api.listImportableSessions(props.machineId, agent).then((value) => {
            if (active) setResults((current) => ({ ...current, [agent]: value }))
        }).catch((reason: unknown) => {
            if (active) setError(reason instanceof Error ? reason.message : t('import.failed'))
        }).finally(() => {
            if (active) setLoading(false)
        })
        return () => { active = false }
    }, [agent, props.api, props.machineId, results, t])

    const sessions = results[agent]?.sessions ?? []

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={props.onClose}>
            <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-t-2xl bg-[var(--app-bg)] sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-[var(--app-divider)] px-4 py-3">
                    <h2 className="font-semibold">{t('import.title')}</h2>
                    <button type="button" onClick={props.onClose} aria-label={t('common.close')}>✕</button>
                </div>
                <div className="flex gap-2 border-b border-[var(--app-divider)] px-4 py-2">
                    {(['claude', 'codex'] as const).map((value) => (
                        <button key={value} type="button" onClick={() => setAgent(value)} className={`rounded px-3 py-1 text-sm ${agent === value ? 'bg-[var(--app-secondary-bg)] font-medium' : ''}`}>
                            {value === 'claude' ? 'Claude Code' : 'Codex'}
                        </button>
                    ))}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {loading ? <p className="p-6 text-center text-sm text-[var(--app-hint)]">{t('import.loading')}</p> : null}
                    {error ? <p className="p-6 text-center text-sm text-red-600">{error}</p> : null}
                    {!loading && !error && sessions.length === 0 ? <p className="p-6 text-center text-sm text-[var(--app-hint)]">{t('import.empty')}</p> : null}
                    {sessions.map((session) => (
                        <div key={session.externalSessionId} className="flex items-center gap-3 border-b border-[var(--app-divider)] px-4 py-3">
                            <AgentFlavorIcon flavor={session.agent} className="h-4 w-4 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm">{session.previewTitle}</div>
                                <div className="truncate text-xs text-[var(--app-hint)]">{session.previewPrompt ?? session.cwd ?? session.externalSessionId}</div>
                            </div>
                            <button
                                type="button"
                                disabled={session.alreadyImported || importing !== null}
                                className="rounded bg-[var(--app-link)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                                onClick={async () => {
                                    setImporting(session.externalSessionId)
                                    setError(null)
                                    try {
                                        const result = await props.api.importExistingSession(props.machineId, agent, session.externalSessionId)
                                        if (result.type === 'error') throw new Error(result.error)
                                        props.onImported(result.sessionId)
                                    } catch (reason) {
                                        setError(reason instanceof Error ? reason.message : t('import.failed'))
                                    } finally {
                                        setImporting(null)
                                    }
                                }}
                            >
                                {session.alreadyImported ? t('import.imported') : importing === session.externalSessionId ? t('import.importing') : t('import.action')}
                            </button>
                        </div>
                    ))}
                    {results[agent]?.nextCursor ? (
                        <button
                            type="button"
                            disabled={loadingMore}
                            className="w-full px-4 py-3 text-sm text-[var(--app-link)] disabled:opacity-50"
                            onClick={async () => {
                                const cursor = results[agent]?.nextCursor
                                if (!cursor) return
                                setLoadingMore(true)
                                try {
                                    const next = await props.api.listImportableSessions(props.machineId, agent, cursor)
                                    setResults((current) => ({
                                        ...current,
                                        [agent]: { sessions: [...(current[agent]?.sessions ?? []), ...next.sessions], nextCursor: next.nextCursor }
                                    }))
                                } catch (reason) {
                                    setError(reason instanceof Error ? reason.message : t('import.failed'))
                                } finally {
                                    setLoadingMore(false)
                                }
                            }}
                        >
                            {loadingMore ? t('import.loading') : t('misc.loadOlder')}
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    )
}
