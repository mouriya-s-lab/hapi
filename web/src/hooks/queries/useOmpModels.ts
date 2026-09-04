import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
    isFetching: boolean
    isRefreshing: boolean
    error: string | null
    refetch: () => Promise<void>
    refresh: () => Promise<void>
} {
    const { api, sessionId } = args
    const enabled = Boolean(args.enabled && api && sessionId)
    const queryClient = useQueryClient()
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [refreshError, setRefreshError] = useState<string | null>(null)
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

    const refresh = useCallback(async () => {
        if (!api || !sessionId) return
        setIsRefreshing(true)
        setRefreshError(null)
        try {
            const result = await api.refreshSessionOmpModels(sessionId)
            await queryClient.setQueryData(
                sessionId ? queryKeys.sessionOmpModels(sessionId) : ['session-omp-models', 'unknown'],
                result
            )
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to refresh OMP models'
            setRefreshError(message)
        } finally {
            setIsRefreshing(false)
        }
    }, [api, sessionId, queryClient])

    return {
        availableModels: query.data?.availableModels ?? [],
        currentModel: query.data?.currentModel ?? null,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        isRefreshing,
        error: refreshError
            ?? (query.data?.success === false
                ? query.data.error ?? 'Failed to load OMP models'
                : query.error instanceof Error ? query.error.message : null),
        refetch: async () => {
            setRefreshError(null)
            await query.refetch()
        },
        /**
         * Force a fresh catalog fetch from the OMP subprocess. Unlike `refetch`
         * (which just re-reads the cached in-memory catalog), this calls the
         * POST /omp-models/refresh endpoint which runs `omp models refresh --json`
         * on the CLI side, re-discovering all authenticated providers.
         * Updates the same query cache so the UI reactively shows new models.
         */
        refresh
    }
}
