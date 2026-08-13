import { FormEvent, useEffect, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import type { ImportableSessionProvider, ImportableSessionsPage } from '@hapi/protocol/apiTypes'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'

const emptyPage: ImportableSessionsPage = { sessions: [], nextCursor: null }

function SearchIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
}

export function ImportExistingSessionsDialog(props: {
    api: ApiClient
    machines: Machine[]
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess: (sessionId: string) => void
}) {
    const { t } = useTranslation()
    const [machineId, setMachineId] = useState('')
    const [provider, setProvider] = useState<ImportableSessionProvider>('codex')
    const [page, setPage] = useState<ImportableSessionsPage>(emptyPage)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [importing, setImporting] = useState<string | null>(null)
    const [cwdInput, setCwdInput] = useState('')
    const [queryInput, setQueryInput] = useState('')
    const [filters, setFilters] = useState({ cwd: '', query: '' })
    const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([undefined])
    const [pageIndex, setPageIndex] = useState(0)
    const requestGeneration = useRef(0)

    useEffect(() => {
        if (props.machines.some((machine) => machine.id === machineId)) return
        setMachineId(props.machines.find((machine) => machine.active)?.id ?? props.machines[0]?.id ?? '')
    }, [props.machines, machineId])

    const load = async (requestedProvider: ImportableSessionProvider, cursor: string | undefined, requestedFilters: typeof filters) => {
        const generation = ++requestGeneration.current
        setLoading(true)
        setError(null)
        try {
            if (!machineId) return
            const next = await props.api.listImportableSessions(machineId, requestedProvider, {
                cursor,
                cwd: requestedFilters.cwd || undefined,
                query: requestedFilters.query || undefined
            })
            if (generation === requestGeneration.current) setPage(next)
        } catch (value) {
            if (generation === requestGeneration.current) setError(value instanceof Error ? value.message : t('newSession.import.loadFailed'))
        } finally {
            if (generation === requestGeneration.current) setLoading(false)
        }
    }

    const resetAndLoad = (requestedProvider: ImportableSessionProvider, requestedFilters: typeof filters) => {
        setPage(emptyPage)
        setCursorHistory([undefined])
        setPageIndex(0)
        void load(requestedProvider, undefined, requestedFilters)
    }

    useEffect(() => {
        requestGeneration.current += 1
        setPage(emptyPage)
        setError(null)
        setLoading(false)
        setCursorHistory([undefined])
        setPageIndex(0)
        if (props.open && machineId) void load(provider, undefined, filters)
    }, [props.open, provider, machineId])

    const applyFilters = (event: FormEvent) => {
        event.preventDefault()
        const next = { cwd: cwdInput.trim(), query: queryInput.trim() }
        setFilters(next)
        resetAndLoad(provider, next)
    }

    const goNext = () => {
        if (!page.nextCursor) return
        const nextIndex = pageIndex + 1
        setCursorHistory((current) => [...current.slice(0, nextIndex), page.nextCursor!])
        setPageIndex(nextIndex)
        void load(provider, page.nextCursor, filters)
    }

    const goPrevious = () => {
        if (pageIndex === 0) return
        const nextIndex = pageIndex - 1
        setPageIndex(nextIndex)
        void load(provider, cursorHistory[nextIndex], filters)
    }

    const importSession = async (externalSessionId: string) => {
        setImporting(externalSessionId)
        setError(null)
        try {
            if (!machineId) throw new Error(t('newSession.import.machineRequired'))
            const result = await props.api.importExistingSession(machineId, provider, externalSessionId)
            if (result.type === 'error') throw new Error(result.error)
            props.onSuccess(result.sessionId)
        } catch (value) {
            setError(value instanceof Error ? value.message : t('newSession.import.importFailed'))
        } finally {
            setImporting(null)
        }
    }

    return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className="flex max-h-[88dvh] max-w-3xl flex-col overflow-hidden p-0">
            <DialogHeader className="px-6 pt-6">
                <DialogTitle>{t('newSession.import.title')}</DialogTitle>
                <DialogDescription>{t('newSession.import.description')}</DialogDescription>
            </DialogHeader>
            <label className="grid gap-1 px-6 text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.import.machine')}
                <select value={machineId} onChange={(event) => setMachineId(event.target.value)} className="h-9 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 text-sm text-[var(--app-fg)]">
                    <option value="">{t('newSession.import.machineRequired')}</option>
                    {props.machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.metadata?.host ?? machine.id}</option>)}
                </select>
            </label>
            <div className="grid grid-cols-2 border-b border-[var(--app-divider)]" role="tablist">
                {(['codex', 'claude'] as const).map((value) => <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={provider === value}
                    onClick={() => setProvider(value)}
                    className={`relative py-3 text-sm font-semibold transition-colors hover:bg-[var(--app-subtle-bg)] ${provider === value ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)]'}`}
                >
                    {value === 'codex' ? 'Codex' : 'Claude Code'}
                    <span className={`absolute bottom-0 left-1/2 h-0.5 w-12 -translate-x-1/2 rounded-full ${provider === value ? 'bg-[var(--app-link)]' : 'bg-transparent'}`} />
                </button>)}
            </div>
            <form onSubmit={applyFilters} className="grid gap-3 border-b border-[var(--app-divider)] bg-[var(--app-subtle-bg)]/40 px-4 py-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-medium text-[var(--app-hint)]">
                    {t('newSession.import.directory')}
                    <input value={cwdInput} onChange={(event) => setCwdInput(event.target.value)} placeholder="/path/to/project" className="h-9 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)]" />
                </label>
                <label className="grid gap-1 text-xs font-medium text-[var(--app-hint)]">
                    {t('newSession.import.content')}
                    <span className="flex gap-2">
                        <span className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 focus-within:border-[var(--app-link)]">
                            <SearchIcon />
                            <input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder={t('newSession.import.contentPlaceholder')} className="min-w-0 flex-1 bg-transparent text-sm text-[var(--app-fg)] outline-none" />
                        </span>
                        <Button type="submit" size="sm" className="h-9">{t('newSession.import.search')}</Button>
                    </span>
                </label>
            </form>
            {error ? <div className="mx-4 mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</div> : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-4">
                {loading ? <div className="py-10 text-center text-sm text-[var(--app-hint)]">{t('newSession.import.loading')}</div> : null}
                {!loading && page.sessions.length === 0 ? <div className="py-10 text-center text-sm text-[var(--app-hint)]">{t('newSession.import.empty')}</div> : null}
                {!loading && page.sessions.map((session) => <div key={session.externalSessionId} className="flex items-start justify-between gap-4 border-b border-[var(--app-divider)] py-3 last:border-b-0">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{session.title}</div>
                        <div className="mt-0.5 truncate text-xs text-[var(--app-hint)]">{session.cwd}</div>
                        {session.preview ? <div className="mt-1 line-clamp-2 text-sm text-[var(--app-hint)]">{session.preview}</div> : null}
                    </div>
                    <Button size="sm" type="button" disabled={importing !== null} onClick={() => session.importedHapiSessionId ? props.onSuccess(session.importedHapiSessionId) : void importSession(session.externalSessionId)}>
                        {session.importedHapiSessionId ? t('newSession.import.open') : importing === session.externalSessionId ? t('newSession.import.importing') : t('newSession.import.import')}
                    </Button>
                </div>)}
            </div>
            <div className="flex items-center justify-between border-t border-[var(--app-divider)] px-4 py-3">
                <span className="text-xs text-[var(--app-hint)]">{t('newSession.import.page', { page: pageIndex + 1 })}</span>
                <div className="flex gap-2">
                    <Button type="button" variant="secondary" size="sm" disabled={loading || pageIndex === 0} onClick={goPrevious}>{t('newSession.import.previous')}</Button>
                    <Button type="button" variant="secondary" size="sm" disabled={loading || !page.nextCursor} onClick={goNext}>{t('newSession.import.next')}</Button>
                </div>
            </div>
        </DialogContent>
    </Dialog>
}
