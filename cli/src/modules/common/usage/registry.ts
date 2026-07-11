import { OpenUsageProvider } from './openUsageProvider'
import type { UsageProvider } from './types'

const providers: readonly UsageProvider[] = [
    new OpenUsageProvider()
]

export function listUsageProviderAdapters(): readonly UsageProvider[] {
    return providers
}

export function getUsageProviderAdapter(providerId: string): UsageProvider {
    const provider = providers.find((candidate) => candidate.id === providerId)
    if (!provider) throw new Error(`Unknown usage provider: ${providerId}`)
    return provider
}
