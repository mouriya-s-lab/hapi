import type { UsageProviderSummary, UsageSnapshot } from '@hapi/protocol/apiTypes'

export type UsageQuery = {
    subjectId?: string
}

export interface UsageProvider {
    readonly id: string
    readonly name: string
    inspect(): Promise<UsageProviderSummary>
    query(query: UsageQuery): Promise<UsageSnapshot>
}
