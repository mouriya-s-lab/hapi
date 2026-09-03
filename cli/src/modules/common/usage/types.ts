import type { UsageSnapshot } from '@hapi/protocol/schemas'

export type UsageProviderInspection = {
    id: string
    name: string
    available: boolean
}

export type UsageQuery = {
    subjectId?: string
}

export interface UsageProvider {
    readonly id: string
    readonly name: string
    inspect(): Promise<UsageProviderInspection>
    query(query: UsageQuery): Promise<UsageSnapshot>
}
