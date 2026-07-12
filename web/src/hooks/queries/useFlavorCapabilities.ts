import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'

export type FlavorForkCapability = {
    fork: 'none' | 'head-only' | 'at-message'
    files: 'none'
}

export interface FlavorCapabilities {
    capabilities: Record<string, FlavorForkCapability>
}

/**
 * Per-server flavor capability map. Each flavor's `fork` slot indicates
 * whether the underlying provider supports session fork and at what point
 * granularity ('head-only' vs 'at-message'). The `files` slot is reserved
 * for a future filesystem-checkpoint capability. Cached 10 min — the table
 * is a static const in fork-features and only changes on hub restart.
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

const NONE_CAPABILITY: FlavorForkCapability = { fork: 'none', files: 'none' }

/** Read a flavor's capability with a safe default for unknown flavors. */
export function getFlavorForkCapability(
    caps: FlavorCapabilities | undefined,
    flavor: string | null | undefined
): FlavorForkCapability {
    if (!caps || !flavor) return NONE_CAPABILITY
    return caps.capabilities[flavor] ?? NONE_CAPABILITY
}
