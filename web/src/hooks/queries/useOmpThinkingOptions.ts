import { useQuery } from '@tanstack/react-query'
import type { OmpThinkingOption, OmpThinkingOptionsResponse } from '@hapi/protocol/apiTypes'
import type { OmpThinkingState } from '@hapi/protocol/omp'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

export function useOmpThinkingOptions(args: {
    api: ApiClient | null
    sessionId?: string | null
    enabled?: boolean
}): {
    options: OmpThinkingOption[]
    state: OmpThinkingState | null
    isLoading: boolean
    error: string | null
    refetch: () => Promise<void>
} {
    const { api, sessionId } = args
    const enabled = Boolean(args.enabled && api && sessionId)
    const query = useQuery({
        queryKey: sessionId ? queryKeys.sessionOmpThinkingOptions(sessionId) : ['session-omp-thinking-options', 'unknown'] as const,
        queryFn: async (): Promise<OmpThinkingOptionsResponse> => {
            if (!api || !sessionId) throw new Error('OMP thinking target unavailable')
            return await api.getSessionOmpThinkingOptions(sessionId)
        },
        enabled,
        staleTime: 10_000,
        retry: 2
    })

    return {
        options: query.data?.options ?? [],
        state: query.data?.state ?? null,
        isLoading: query.isLoading,
        error: query.data?.success === false
            ? query.data.error ?? 'Failed to load OMP thinking options'
            : query.error instanceof Error ? query.error.message : null,
        refetch: async () => {
            await query.refetch()
        }
    }
}
