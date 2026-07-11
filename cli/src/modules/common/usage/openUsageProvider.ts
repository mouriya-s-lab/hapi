import { z } from 'zod'
import type { UsageMetric, UsageSnapshot } from '@hapi/protocol/schemas'
import type { UsageProvider, UsageProviderInspection, UsageQuery } from './types'

const OPENUSAGE_BASE_URL = 'http://127.0.0.1:6736'

const OpenUsageProgressLineSchema = z.object({
    type: z.literal('progress'),
    label: z.string(),
    used: z.number(),
    limit: z.number(),
    format: z.object({ kind: z.string() }),
    resetsAt: z.string().nullable().optional()
}).passthrough()

const OpenUsageTextLineSchema = z.object({
    type: z.literal('text'),
    label: z.string(),
    value: z.string()
}).passthrough()

const OpenUsageBadgeLineSchema = z.object({
    type: z.literal('badge'),
    label: z.string(),
    text: z.string()
}).passthrough()

const OpenUsageBarChartLineSchema = z.object({
    type: z.literal('barChart'),
    label: z.string(),
    points: z.array(z.object({ label: z.string(), value: z.number(), valueLabel: z.string().nullable().optional() }).passthrough()),
    note: z.string().nullable().optional()
}).passthrough()

const OpenUsageSnapshotSchema = z.object({
    providerId: z.string(),
    displayName: z.string(),
    plan: z.string().nullable(),
    lines: z.array(z.union([OpenUsageProgressLineSchema, OpenUsageTextLineSchema, OpenUsageBadgeLineSchema, OpenUsageBarChartLineSchema])),
    fetchedAt: z.string()
}).strict()

type OpenUsageSnapshot = z.infer<typeof OpenUsageSnapshotSchema>

export class OpenUsageProvider implements UsageProvider {
    readonly id = 'openusage'
    readonly name = 'OpenUsage'

    async inspect(): Promise<UsageProviderInspection> {
        try {
            const response = await fetch(`${OPENUSAGE_BASE_URL}/v1/usage/claude`)
            return { id: this.id, name: this.name, available: response.status === 200 }
        } catch {
            return { id: this.id, name: this.name, available: false }
        }
    }

    async query(query: UsageQuery): Promise<UsageSnapshot> {
        const subjectId = query.subjectId ?? 'claude'
        const response = await fetch(`${OPENUSAGE_BASE_URL}/v1/usage/${encodeURIComponent(subjectId)}`)
        if (response.status === 204) throw new Error(`OpenUsage has no cached snapshot for ${subjectId}`)
        if (!response.ok) throw new Error(`OpenUsage returned HTTP ${response.status}`)
        return toUsageSnapshot(OpenUsageSnapshotSchema.parse(await response.json()))
    }
}

function toUsageSnapshot(snapshot: OpenUsageSnapshot): UsageSnapshot {
    const metrics: UsageMetric[] = snapshot.lines.flatMap((line): UsageMetric[] => {
        if (line.type === 'progress') {
            return [{
                type: 'progress',
                label: line.label,
                used: line.used,
                limit: line.limit,
                unit: line.format.kind === 'percent' ? 'percent' : 'count',
                resetsAt: line.resetsAt ?? null
            }]
        }
        if (line.type === 'text') return [{ type: 'text', label: line.label, value: line.value }]
        if (line.type === 'badge') return [{ type: 'badge', label: line.label, text: line.text }]
        return [{
            type: 'barChart',
            label: line.label,
            points: line.points.map((point) => ({ ...point, valueLabel: point.valueLabel ?? null })),
            note: line.note ?? null
        }]
    })
    return {
        providerId: 'openusage',
        displayName: snapshot.displayName,
        plan: snapshot.plan,
        metrics,
        fetchedAt: snapshot.fetchedAt
    }
}
