import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'

export interface FlavorCapabilities {
    fork: string[]
}

/**
 * Per-server flavor capability list (currently just which flavors support
 * session fork). Cached 10 min — capability registration only changes when
 * fork-features adds/removes a provider, which requires a hub restart.
 */
export function useFlavorCapabilities(api: ApiClient | null) {
    return useQuery<FlavorCapabilities>({
        queryKey: ['flavor-capabilities'] as const,
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getFlavorCapabilities()
        },
        enabled: api !== null,
        staleTime: 10 * 60 * 1000
    })
}
