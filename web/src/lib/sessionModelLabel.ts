import { getClaudeModelLabel } from '@hapi/protocol'
import type { CcSwitchUsageResult } from '@hapi/protocol'

type SessionModelSource = {
    model?: string | null
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

/**
 * 把 cc-switch 供应商名 + 用量格式化为顶部标签,如 "GACCode · 余 $12.5" / "Zhipu GLM · 余 3000 tokens"。
 * 用量无效或缺失时只显示源名。数字过长时按原值展示(余额单位由 usage_script 决定)。
 */
export function formatCcSwitchSourceLabel(
    providerName: string | null | undefined,
    usage: CcSwitchUsageResult | null | undefined,
    remainingPrefix: string
): string | null {
    const name = providerName?.trim()
    if (!name) {
        return null
    }
    if (!usage || usage.isValid === false) {
        return name
    }
    const remaining = usage.remaining
    if (remaining === null || remaining === undefined || Number.isNaN(remaining)) {
        // 没有可用余额数字时,退回展示 planName(若有)或仅源名。
        const plan = usage.planName?.trim()
        return plan ? `${name} · ${plan}` : name
    }
    const unit = usage.unit?.trim()
    const remainingText = unit === '$' || unit === 'USD'
        ? `$${formatUsageNumber(remaining)}`
        : `${formatUsageNumber(remaining)}${unit ? ` ${unit}` : ''}`
    return `${name} · ${remainingPrefix}${remainingText}`
}

function formatUsageNumber(value: number): string {
    // 整数直接显示;小数最多保留两位,去掉多余的 0。
    if (Number.isInteger(value)) {
        return value.toLocaleString('en-US')
    }
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
