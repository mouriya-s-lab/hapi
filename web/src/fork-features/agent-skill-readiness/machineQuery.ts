import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'

export const agentSkillMachinesQueryKey = ['agent-skill-machines'] as const

export function useAgentSkillMachines(api: ApiClient | null): {
    machines: Machine[]
    isLoading: boolean
    error: string | null
} {
    const query = useQuery({
        queryKey: agentSkillMachinesQueryKey,
        queryFn: () => api!.getMachines(),
        enabled: Boolean(api)
    })

    return {
        machines: query.data?.machines ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : null
    }
}
