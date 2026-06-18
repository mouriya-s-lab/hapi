import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ImportableSessionSummary, ImportSessionsResult } from '@hapi/protocol/apiTypes'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'
import { cn } from '@/lib/utils'

/**
 * 历史会话导入对话框(功能1)。
 * 列出目标机器上可导入的 claude code / codex 会话,勾选后一键导入到 hapi。
 * 扫描与读取都在目标机器本地完成(经 hub RPC 转发),hub 只写库。
 */
export function ImportSessionsDialog(props: {
    api: ApiClient
    machineId: string
    onClose: () => void
    onImported: () => void
}) {
    const { t } = useTranslation()
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [importing, setImporting] = useState(false)
    const [result, setResult] = useState<ImportSessionsResult | null>(null)
    const [importError, setImportError] = useState<string | null>(null)

    const listQuery = useQuery({
        queryKey: queryKeys.machineImportableSessions(props.machineId),
        queryFn: async () => props.api.getMachineImportableSessions(props.machineId),
        staleTime: 30_000,
        retry: false,
    })

    const sessions = useMemo(() => listQuery.data?.sessions ?? [], [listQuery.data])
    const listError = listQuery.data?.success === false
        ? (listQuery.data.error ?? t('import.loadFailed'))
        : listQuery.error
            ? t('import.loadFailed')
            : null

    const toggle = useCallback((id: string) => {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }, [])

    const toggleAll = useCallback(() => {
        setSelected((prev) => {
            if (prev.size === sessions.length) return new Set()
            return new Set(sessions.map((s) => s.id))
        })
    }, [sessions])

    const handleImport = useCallback(async () => {
        const chosen = sessions.filter((s) => selected.has(s.id))
        if (chosen.length === 0) return
        setImporting(true)
        setImportError(null)
        setResult(null)
        try {
            const res = await props.api.importMachineSessions(props.machineId, chosen)
            setResult(res)
            if (res.importedCount > 0) {
                props.onImported()
            }
        } catch (error) {
            setImportError(error instanceof Error ? error.message : t('import.failed'))
        } finally {
            setImporting(false)
        }
    }, [sessions, selected, props, t])

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={props.onClose}>
            <div
                className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl bg-[var(--app-bg)] shadow-xl sm:rounded-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <ImportDialogHeader
                    title={t('import.title')}
                    onClose={props.onClose}
                />
                <ImportDialogBody
                    loading={listQuery.isLoading}
                    listError={listError}
                    sessions={sessions}
                    selected={selected}
                    onToggle={toggle}
                    onToggleAll={toggleAll}
                    result={result}
                    importError={importError}
                    formatPreview={formatPreview}
                    renderFlavor={(flavor) => <AgentFlavorIcon flavor={flavor} className="h-3.5 w-3.5 shrink-0" />}
                />
                <ImportDialogFooter
                    selectedCount={selected.size}
                    totalCount={sessions.length}
                    importing={importing}
                    onImport={handleImport}
                    onClose={props.onClose}
                />
            </div>
        </div>
    )
}

function formatPreview(s: ImportableSessionSummary): string {
    const parts: string[] = []
    if (s.cwd) parts.push(s.cwd)
    parts.push(`${s.messageCount} msgs`)
    return parts.join(' · ')
}

function ImportDialogHeader(props: { title: string; onClose: () => void }) {
    return (
        <div className="flex items-center justify-between border-b border-[var(--app-divider)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--app-fg)]">{props.title}</h2>
            <button
                type="button"
                onClick={props.onClose}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                aria-label="close"
            >
                ✕
            </button>
        </div>
    )
}

function ImportDialogFooter(props: {
    selectedCount: number
    totalCount: number
    importing: boolean
    onImport: () => void
    onClose: () => void
}) {
    const { t } = useTranslation()
    return (
        <div className="flex items-center justify-between gap-2 border-t border-[var(--app-divider)] px-4 py-3">
            <span className="text-xs text-[var(--app-hint)]">
                {t('import.selectedCount', { selected: props.selectedCount, total: props.totalCount })}
            </span>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={props.onClose}
                    className="rounded-lg px-3 py-1.5 text-sm text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                >
                    {t('common.close')}
                </button>
                <button
                    type="button"
                    disabled={props.selectedCount === 0 || props.importing}
                    onClick={props.onImport}
                    className={cn(
                        'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                        props.selectedCount === 0 || props.importing
                            ? 'cursor-not-allowed bg-[var(--app-secondary-bg)] text-[var(--app-hint)]'
                            : 'bg-[var(--app-link)] text-white hover:opacity-90'
                    )}
                >
                    {props.importing ? t('import.importing') : t('import.action')}
                </button>
            </div>
        </div>
    )
}

function ImportDialogBody(props: {
    loading: boolean
    listError: string | null
    sessions: ImportableSessionSummary[]
    selected: Set<string>
    onToggle: (id: string) => void
    onToggleAll: () => void
    result: ImportSessionsResult | null
    importError: string | null
    formatPreview: (s: ImportableSessionSummary) => string
    renderFlavor: (flavor: string) => React.ReactNode
}) {
    const { t } = useTranslation()

    if (props.loading) {
        return <div className="px-4 py-8 text-center text-sm text-[var(--app-hint)]">{t('import.loading')}</div>
    }
    if (props.listError) {
        return <div className="px-4 py-8 text-center text-sm text-red-600">{props.listError}</div>
    }
    if (props.sessions.length === 0) {
        return <div className="px-4 py-8 text-center text-sm text-[var(--app-hint)]">{t('import.empty')}</div>
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {props.result || props.importError ? (
                <div className="border-b border-[var(--app-divider)] px-4 py-2 text-xs">
                    {props.importError ? (
                        <span className="text-red-600">{props.importError}</span>
                    ) : props.result ? (
                        <span className="text-[var(--app-fg)]">
                            {t('import.result', {
                                imported: props.result.importedCount,
                                skipped: props.result.skippedCount,
                                failed: props.result.failedCount
                            })}
                        </span>
                    ) : null}
                </div>
            ) : null}
            <div className="flex items-center justify-between px-4 py-2">
                <button
                    type="button"
                    onClick={props.onToggleAll}
                    className="text-xs text-[var(--app-link)] hover:underline"
                >
                    {props.selected.size === props.sessions.length ? t('import.deselectAll') : t('import.selectAll')}
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {props.sessions.map((s) => {
                    const isSelected = props.selected.has(s.id)
                    return (
                        <button
                            key={`${s.flavor}:${s.id}`}
                            type="button"
                            onClick={() => props.onToggle(s.id)}
                            className="flex w-full items-start gap-3 border-b border-[var(--app-divider)] px-4 py-2.5 text-left transition-colors hover:bg-[var(--app-secondary-bg)]"
                        >
                            <div
                                className={cn(
                                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2',
                                    isSelected ? 'border-[var(--app-link)] bg-[var(--app-link)]' : 'border-[var(--app-hint)]'
                                )}
                            >
                                {isSelected && <span className="text-[10px] leading-none text-white">✓</span>}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    {props.renderFlavor(s.flavor)}
                                    <span className="truncate text-sm text-[var(--app-fg)]">{s.title}</span>
                                </div>
                                <div className="mt-0.5 truncate text-xs text-[var(--app-hint)]">{props.formatPreview(s)}</div>
                            </div>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
