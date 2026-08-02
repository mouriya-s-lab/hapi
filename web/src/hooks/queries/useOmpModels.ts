import { useQuery } from '@tanstack/react-query'
import type { OmpModelSummary, OmpModelsResponse } from '@hapi/protocol/apiTypes'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

export function useOmpModels(args: {
    api: ApiClient | null
    sessionId?: string | null
    enabled?: boolean
}): {
    availableModels: OmpModelSummary[]
    currentModel: { provider: string; modelId: string } | null
    isLoading: boolean
    error: string | null
    refetch: () => Promise<void>
} {
    const { api, sessionId } = args
    const enabled = Boolean(args.enabled && api && sessionId)
    const query = useQuery({
        queryKey: sessionId ? queryKeys.sessionOmpModels(sessionId) : ['session-omp-models', 'unknown'] as const,
        queryFn: async (): Promise<OmpModelsResponse> => {
            if (!api || !sessionId) throw new Error('OMP model target unavailable')
            return await api.getSessionOmpModels(sessionId)
        },
        enabled,
        staleTime: 30_000,
        retry: 2
    })

    return {
        availableModels: query.data?.availableModels ?? [],
        currentModel: query.data?.currentModel ?? null,
        isLoading: query.isLoading,
        error: query.data?.success === false
            ? query.data.error ?? 'Failed to load OMP models'
            : query.error instanceof Error ? query.error.message : null,
        refetch: async () => {
            await query.refetch()
        }
    }
}
