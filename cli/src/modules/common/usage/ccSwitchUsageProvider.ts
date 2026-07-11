import type { UsageMetric, UsageProviderSummary, UsageSnapshot } from '@hapi/protocol/apiTypes'
import { listCcSwitchProviders, queryCcSwitchUsage } from '../ccSwitch'
import type { UsageProvider, UsageQuery } from './types'

export class CcSwitchUsageProvider implements UsageProvider {
    readonly id = 'cc-switch'
    readonly name = 'cc-switch'

    async inspect(): Promise<UsageProviderSummary> {
        const result = listCcSwitchProviders()
        const current = result.providers.find((provider) => provider.isCurrent)
        return { id: this.id, name: this.name, available: result.available && current?.hasUsageScript === true }
    }

    async query(query: UsageQuery): Promise<UsageSnapshot> {
        const result = await queryCcSwitchUsage(query.subjectId)
        if (!result.usage || result.error) throw new Error(result.error ?? 'cc-switch returned no usage')
        if (!result.usage.isValid) throw new Error(result.usage.invalidMessage ?? 'cc-switch usage is invalid')

        const metrics: UsageMetric[] = []
        if (result.usage.total !== null && result.usage.remaining !== null) {
            metrics.push({
                type: 'progress',
                label: 'Quota',
                used: result.usage.total - result.usage.remaining,
                limit: result.usage.total,
                unit: 'count',
                resetsAt: null
            })
        } else if (result.usage.remaining !== null) {
            metrics.push({
                type: 'text',
                label: 'Remaining',
                value: `${result.usage.remaining}${result.usage.unit ? ` ${result.usage.unit}` : ''}`
            })
        }

        return {
            providerId: this.id,
            displayName: result.providerName ?? this.name,
            plan: result.usage.planName,
            metrics,
            fetchedAt: new Date().toISOString()
        }
    }
}
