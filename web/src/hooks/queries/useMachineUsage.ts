import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { UsageSnapshot } from '@hapi/protocol'
import { queryKeys } from '@/lib/query-keys'

const USAGE_PROVIDER_PRIORITY = ['openusage', 'cc-switch'] as const

export function useMachineUsage(args: {
    api: ApiClient | null
    machineId?: string | null
    subjectId?: string
    enabled?: boolean
}): {
    providerId: string | null
    snapshot: UsageSnapshot | null
    isLoading: boolean
    error: string | null
} {
    const { api, machineId, subjectId = 'claude' } = args
    const enabled = Boolean(args.enabled && api && machineId)
    const providersQuery = useQuery({
        queryKey: machineId ? queryKeys.machineUsageProviders(machineId) : ['machine-usage-providers', 'unknown'] as const,
        queryFn: async () => {
            if (!api || !machineId) throw new Error('Usage target unavailable')
            return await api.getMachineUsageProviders(machineId)
        },
        enabled,
        staleTime: 60_000,
        retry: false
    })
    const selectedProviderId = USAGE_PROVIDER_PRIORITY.find((providerId) =>
        providersQuery.data?.providers?.some((provider) => provider.id === providerId && provider.available)
    ) ?? null
    const usageQuery = useQuery({
        queryKey: machineId && selectedProviderId
            ? queryKeys.machineUsage(machineId, selectedProviderId, subjectId)
            : ['machine-usage', 'unknown'] as const,
        queryFn: async () => {
            if (!api || !machineId || !selectedProviderId) throw new Error('Usage provider unavailable')
            return await api.getMachineUsage(machineId, selectedProviderId, subjectId)
        },
        enabled: enabled && selectedProviderId !== null,
        staleTime: 5 * 60_000,
        refetchInterval: 5 * 60_000,
        retry: false
    })
    return {
        providerId: selectedProviderId,
        snapshot: usageQuery.data?.success === true ? usageQuery.data.snapshot ?? null : null,
        isLoading: providersQuery.isLoading || usageQuery.isLoading,
        error: providersQuery.data?.success === false
            ? providersQuery.data.error ?? 'Failed to list usage providers'
            : usageQuery.data?.success === false
                ? usageQuery.data.error ?? 'Failed to query usage'
                : providersQuery.error instanceof Error
                    ? providersQuery.error.message
                    : usageQuery.error instanceof Error
                        ? usageQuery.error.message
                        : null
    }
}
