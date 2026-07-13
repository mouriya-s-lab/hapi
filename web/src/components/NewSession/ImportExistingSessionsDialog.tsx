import { useEffect, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { ImportableSessionProvider, ImportableSessionsPage } from '@hapi/protocol/apiTypes'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'

export function ImportExistingSessionsDialog(props: {
    api: ApiClient
    machineId: string
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess: (sessionId: string) => void
}) {
    const { t } = useTranslation()
    const [provider, setProvider] = useState<ImportableSessionProvider>('codex')
    const [page, setPage] = useState<ImportableSessionsPage>({ sessions: [], nextCursor: null })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [importing, setImporting] = useState<string | null>(null)
    const requestGeneration = useRef(0)

    const load = async (requestedProvider: ImportableSessionProvider, cursor?: string) => {
        const generation = ++requestGeneration.current
        setLoading(true)
        setError(null)
        try {
            const next = await props.api.listImportableSessions(props.machineId, requestedProvider, cursor)
            if (generation !== requestGeneration.current) return
            setPage((current) => cursor
                ? { sessions: [...current.sessions, ...next.sessions], nextCursor: next.nextCursor }
                : next)
        } catch (value) {
            if (generation !== requestGeneration.current) return
            setError(value instanceof Error ? value.message : t('newSession.import.loadFailed'))
        } finally {
            if (generation === requestGeneration.current) setLoading(false)
        }
    }

    useEffect(() => {
        requestGeneration.current += 1
        setPage({ sessions: [], nextCursor: null })
        setError(null)
        setLoading(false)
        if (props.open) void load(provider)
    }, [props.open, provider, props.machineId])

    const importSession = async (externalSessionId: string) => {
        setImporting(externalSessionId)
        setError(null)
        try {
            const result = await props.api.importExistingSession(props.machineId, provider, externalSessionId)
            if (result.type === 'error') throw new Error(result.error)
            props.onSuccess(result.sessionId)
        } catch (value) {
            setError(value instanceof Error ? value.message : t('newSession.import.importFailed'))
        } finally {
            setImporting(null)
        }
    }

    return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto">
            <DialogHeader>
                <DialogTitle>{t('newSession.import.title')}</DialogTitle>
                <DialogDescription>{t('newSession.import.description')}</DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
                <Button type="button" variant={provider === 'codex' ? 'default' : 'secondary'} onClick={() => setProvider('codex')}>Codex</Button>
                <Button type="button" variant={provider === 'claude' ? 'default' : 'secondary'} onClick={() => setProvider('claude')}>Claude Code</Button>
            </div>
            {error ? <div className="text-sm text-red-600">{error}</div> : null}
            <div className="divide-y divide-[var(--app-divider)] rounded-lg border border-[var(--app-divider)]">
                {page.sessions.map((session) => <div key={session.externalSessionId} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                        <div className="truncate font-medium">{session.title}</div>
                        <div className="truncate text-xs text-[var(--app-hint)]">{session.cwd}</div>
                        {session.preview ? <div className="mt-1 line-clamp-2 text-sm text-[var(--app-hint)]">{session.preview}</div> : null}
                    </div>
                    {session.importedHapiSessionId
                        ? <Button type="button" onClick={() => props.onSuccess(session.importedHapiSessionId!)}>{t('newSession.import.open')}</Button>
                        : <Button type="button" disabled={importing !== null} onClick={() => void importSession(session.externalSessionId)}>
                            {importing === session.externalSessionId ? t('newSession.import.importing') : t('newSession.import.import')}
                        </Button>}
                </div>)}
            </div>
            {page.nextCursor ? <Button type="button" variant="secondary" disabled={loading} onClick={() => void load(provider, page.nextCursor!)}>{loading ? t('newSession.import.loading') : t('misc.loadOlder')}</Button> : null}
            {loading && page.sessions.length === 0 ? <div className="text-sm text-[var(--app-hint)]">{t('newSession.import.loading')}</div> : null}
        </DialogContent>
    </Dialog>
}
