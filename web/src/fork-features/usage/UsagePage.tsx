import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CalendarIcon, SessionDateRangePicker } from '@/components/SessionList'

// fork-features/usage：Token 用量统计页。数据来自 hub 侧
// /api/usage/summary（fork-features/multi-user/executionMount.ts 挂载，
// 可见性与会话列表同构），页面自带取数逻辑，不侵入 ApiClient。

export type UsageModelSummary = {
    model: string
    requestCount: number
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens: number
    cacheReadInputTokens: number
}

export type UsageSummaryResponse = {
    models: UsageModelSummary[]
    totals: Omit<UsageModelSummary, 'model'>
    hosts: string[]
    filter: { since: string | null; until: string | null; host: string | null }
    generatedAt: number
}

const PRESET_RANGES = ['all', '24h', '7d', '30d'] as const
type PresetRange = (typeof PRESET_RANGES)[number]
type RangeKey = PresetRange | 'custom'

/** 预设范围换算成 ISO 起点；'all' 不传 since。 */
function presetToSince(range: PresetRange): string | null {
    if (range === 'all') return null
    const hours = range === '24h' ? 24 : range === '7d' ? 24 * 7 : 24 * 30
    return new Date(Date.now() - hours * 3600_000).toISOString()
}

/** 'YYYY-MM-DD'（本地日）→ 当天 00:00 本地时间的 ISO 串。 */
export function localDayStartIso(day: string): string | null {
    const [year, month, dayOfMonth] = day.split('-').map(Number)
    if (!year || !month || !dayOfMonth) return null
    const date = new Date(year, month - 1, dayOfMonth)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** 'YYYY-MM-DD'（本地日）→ 次日 00:00 本地时间的 ISO 串（until 为开区间上界）。 */
export function localDayEndExclusiveIso(day: string): string | null {
    const [year, month, dayOfMonth] = day.split('-').map(Number)
    if (!year || !month || !dayOfMonth) return null
    const date = new Date(year, month - 1, dayOfMonth + 1)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function formatTokens(n: number): string {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
}

function modelTotal(m: Omit<UsageModelSummary, 'model'>): number {
    return m.inputTokens + m.outputTokens + m.cacheCreationInputTokens + m.cacheReadInputTokens
}

// 固定色板，和现有 UI 对齐不引入图表库，只用 CSS 横向堆叠条。
const SEGMENT_COLORS = {
    input: '#60a5fa',
    output: '#f97316',
    cacheCreation: '#a78bfa',
    cacheRead: '#34d399'
} as const

function UsageBar(props: { model: UsageModelSummary; maxTotal: number }) {
    const { model, maxTotal } = props
    const total = modelTotal(model)
    const widthPct = maxTotal > 0 ? Math.max(1, (total / maxTotal) * 100) : 0
    const segments = [
        { key: 'input', value: model.inputTokens, color: SEGMENT_COLORS.input },
        { key: 'output', value: model.outputTokens, color: SEGMENT_COLORS.output },
        { key: 'cacheCreation', value: model.cacheCreationInputTokens, color: SEGMENT_COLORS.cacheCreation },
        { key: 'cacheRead', value: model.cacheReadInputTokens, color: SEGMENT_COLORS.cacheRead }
    ]

    return (
        <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
                <div className="font-medium">{model.model}</div>
                <div className="text-sm text-[var(--app-hint)]">
                    {formatTokens(total)} tokens · {model.requestCount.toLocaleString()}
                </div>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--app-subtle-bg)]">
                <div className="flex h-full overflow-hidden rounded-full" style={{ width: `${widthPct}%` }}>
                    {segments.map((seg) => {
                        const segPct = total > 0 ? (seg.value / total) * 100 : 0
                        if (segPct <= 0) return null
                        return (
                            <div
                                key={seg.key}
                                style={{ width: `${segPct}%`, backgroundColor: seg.color }}
                                title={`${seg.key}: ${formatTokens(seg.value)}`}
                            />
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

function Legend() {
    const { t } = useTranslation()
    const items = [
        { label: t('usage.legend.input'), color: SEGMENT_COLORS.input },
        { label: t('usage.legend.output'), color: SEGMENT_COLORS.output },
        { label: t('usage.legend.cacheCreation'), color: SEGMENT_COLORS.cacheCreation },
        { label: t('usage.legend.cacheRead'), color: SEGMENT_COLORS.cacheRead }
    ]
    return (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--app-hint)]">
            {items.map((item) => (
                <div key={item.label} className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    {item.label}
                </div>
            ))}
        </div>
    )
}

function ModelTable(props: { models: UsageModelSummary[] }) {
    const { t } = useTranslation()
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
                <thead>
                    <tr className="border-b border-[var(--app-border)] text-left text-[var(--app-hint)]">
                        <th className="py-1.5 pr-3 font-normal">{t('usage.table.model')}</th>
                        <th className="py-1.5 pr-3 text-right font-normal">{t('usage.table.requests')}</th>
                        <th className="py-1.5 pr-3 text-right font-normal">{t('usage.legend.input')}</th>
                        <th className="py-1.5 pr-3 text-right font-normal">{t('usage.legend.output')}</th>
                        <th className="py-1.5 pr-3 text-right font-normal">{t('usage.legend.cacheCreation')}</th>
                        <th className="py-1.5 pr-3 text-right font-normal">{t('usage.legend.cacheRead')}</th>
                        <th className="py-1.5 text-right font-normal">{t('usage.table.total')}</th>
                    </tr>
                </thead>
                <tbody>
                    {props.models.map((m) => (
                        <tr key={m.model} className="border-b border-[var(--app-divider)] last:border-0">
                            <td className="py-1.5 pr-3 font-medium">{m.model}</td>
                            <td className="py-1.5 pr-3 text-right">{m.requestCount.toLocaleString()}</td>
                            <td className="py-1.5 pr-3 text-right">{formatTokens(m.inputTokens)}</td>
                            <td className="py-1.5 pr-3 text-right">{formatTokens(m.outputTokens)}</td>
                            <td className="py-1.5 pr-3 text-right">{formatTokens(m.cacheCreationInputTokens)}</td>
                            <td className="py-1.5 pr-3 text-right">{formatTokens(m.cacheReadInputTokens)}</td>
                            <td className="py-1.5 text-right font-medium">{formatTokens(modelTotal(m))}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

export default function UsagePage() {
    const { baseUrl, token } = useAppContext()
    const navigate = useNavigate()
    const { t } = useTranslation()
    const [range, setRange] = useState<RangeKey>('all')
    const [customStart, setCustomStart] = useState('')
    const [customEnd, setCustomEnd] = useState('')
    const [datePickerOpen, setDatePickerOpen] = useState(false)
    const [host, setHost] = useState('')

    const hasCustomRange = Boolean(customStart && customEnd)

    const { since, until } = useMemo(() => {
        if (range === 'custom') {
            return hasCustomRange
                ? { since: localDayStartIso(customStart), until: localDayEndExclusiveIso(customEnd) }
                : { since: null, until: null }
        }
        return { since: presetToSince(range), until: null }
    }, [range, hasCustomRange, customStart, customEnd])

    const usageQuery = useQuery({
        queryKey: ['fork-usage-summary', range, range === 'custom' ? `${customStart}~${customEnd}` : '', host],
        queryFn: async (): Promise<UsageSummaryResponse> => {
            const search = new URLSearchParams()
            if (since) search.set('since', since)
            if (until) search.set('until', until)
            if (host) search.set('host', host)
            const qs = search.toString()
            const response = await fetch(`${baseUrl}/api/usage/summary${qs ? `?${qs}` : ''}`, {
                headers: { authorization: `Bearer ${token}` }
            })
            if (!response.ok) {
                const body = await response.json().catch(() => null) as { error?: string } | null
                throw new Error(body?.error ?? `HTTP ${response.status}`)
            }
            return await response.json() as UsageSummaryResponse
        },
        staleTime: 60_000,
        refetchInterval: 60_000
    })

    const models = usageQuery.data?.models ?? []
    const maxTotal = models.reduce((max, m) => Math.max(max, modelTotal(m)), 0)
    const totals = usageQuery.data?.totals
    const hosts = usageQuery.data?.hosts ?? []

    const rangeLabel = range === 'custom' && hasCustomRange
        ? `${customStart} – ${customEnd}`
        : t(`usage.range.${range === 'custom' ? 'all' : range}`)

    return (
        <div className="h-full min-h-0 overflow-y-auto bg-[var(--app-bg)] text-[var(--app-fg)]">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-4 py-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
                <div>
                    <div className="text-base font-semibold">{t('usage.title')}</div>
                    <div className="text-xs text-[var(--app-hint)]">{t('usage.subtitle')}</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => navigate({ to: '/sessions' })}>{t('usage.back')}</Button>
            </div>

            <div className="mx-auto max-w-5xl space-y-4 p-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap gap-1.5">
                        {PRESET_RANGES.map((r) => (
                            <Button
                                key={r}
                                size="sm"
                                variant={range === r ? 'default' : 'outline'}
                                onClick={() => setRange(r)}
                            >{t(`usage.range.${r}`)}</Button>
                        ))}
                        <div className="relative">
                            <Button
                                size="sm"
                                variant={range === 'custom' ? 'default' : 'outline'}
                                onClick={() => setDatePickerOpen(open => !open)}
                                title={hasCustomRange ? `${customStart} – ${customEnd}` : t('usage.range.custom')}
                                aria-expanded={datePickerOpen}
                                className="gap-1.5"
                            >
                                <CalendarIcon className="h-4 w-4" />
                                {range === 'custom' && hasCustomRange ? `${customStart} – ${customEnd}` : t('usage.range.custom')}
                            </Button>
                            {datePickerOpen ? (
                                <>
                                    <button
                                        type="button"
                                        aria-label={t('sessions.timeFilter.close')}
                                        className="fixed inset-0 z-20 cursor-default"
                                        onClick={() => setDatePickerOpen(false)}
                                    />
                                    <SessionDateRangePicker
                                        start={customStart}
                                        end={customEnd}
                                        onChange={(start, end) => {
                                            setCustomStart(start)
                                            setCustomEnd(end)
                                            if (start && end) setRange('custom')
                                            else if (!start && !end) setRange('all')
                                        }}
                                        onClose={() => setDatePickerOpen(false)}
                                    />
                                </>
                            ) : null}
                        </div>
                    </div>
                    <select
                        className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-sm text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-button)]"
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                        aria-label={t('usage.host.label')}
                    >
                        <option value="">{t('usage.host.all')}</option>
                        {hosts.map((h) => (
                            <option key={h} value={h}>{h}</option>
                        ))}
                    </select>
                    {usageQuery.isFetching && <span className="text-xs text-[var(--app-hint)]">{t('usage.refreshing')}</span>}
                </div>

                {usageQuery.isLoading && (
                    <Card><CardContent className="py-6 text-center text-sm text-[var(--app-hint)]">{t('usage.loading')}</CardContent></Card>
                )}

                {usageQuery.isError && (
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('usage.error.title')}</CardTitle>
                            <CardDescription>
                                {usageQuery.error instanceof Error ? usageQuery.error.message : t('usage.error.fallback')}
                            </CardDescription>
                        </CardHeader>
                    </Card>
                )}

                {usageQuery.isSuccess && models.length === 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('usage.empty.title')}</CardTitle>
                            <CardDescription>
                                {range === 'all' && !host ? t('usage.empty.hintAll') : t('usage.empty.hintFiltered')}
                            </CardDescription>
                        </CardHeader>
                    </Card>
                )}

                {usageQuery.isSuccess && models.length > 0 && totals && (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle>{t('usage.overview')}</CardTitle>
                                <CardDescription>
                                    {t('usage.overviewSummary', {
                                        requests: totals.requestCount.toLocaleString(),
                                        tokens: formatTokens(modelTotal(totals))
                                    })}
                                    {' · '}{rangeLabel}
                                    {' · '}{host || t('usage.host.all')}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Legend />
                                {models.map((m) => (
                                    <UsageBar key={m.model} model={m} maxTotal={maxTotal} />
                                ))}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>{t('usage.detail')}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ModelTable models={models} />
                            </CardContent>
                        </Card>
                    </>
                )}
            </div>
        </div>
    )
}
