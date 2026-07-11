import { getClaudeModelLabel } from '@hapi/protocol'
import type { CcSwitchUsageResult } from '@hapi/protocol'

type SessionModelSource = {
    model?: string | null
}

export function formatCcSwitchSourceLabel(
    providerName: string | null | undefined,
    usage: CcSwitchUsageResult | null | undefined,
    remainingPrefix: string
): string | null {
    const name = providerName?.trim()
    if (!name) return null
    if (!usage || !usage.isValid) return name
    if (usage.remaining === null) {
        const plan = usage.planName?.trim()
        return plan ? `${name} · ${plan}` : name
    }
    const unit = usage.unit?.trim()
    const amount = Number.isInteger(usage.remaining)
        ? usage.remaining.toLocaleString('en-US')
        : usage.remaining.toLocaleString('en-US', { maximumFractionDigits: 2 })
    const rendered = unit === '$' || unit === 'USD' ? `$${amount}` : `${amount}${unit ? ` ${unit}` : ''}`
    return `${name} · ${remainingPrefix}${rendered}`
}

export type SessionModelLabel = {
    key: 'session.item.model'
    value: string
}

export function getSessionModelLabel(session: SessionModelSource): SessionModelLabel | null {
    const explicitModel = typeof session.model === 'string' ? session.model.trim() : ''
    if (explicitModel) {
        return {
            key: 'session.item.model',
            value: getClaudeModelLabel(explicitModel) ?? explicitModel
        }
    }

    return null
}
