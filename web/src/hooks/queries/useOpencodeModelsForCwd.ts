import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { OpencodeModelsResponse, OpencodeModelSummary } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import type { AgentFlavor } from '@hapi/protocol'

type OpencodeModelDiscoveryAgent = Extract<AgentFlavor, 'opencode' | 'omp'>

function resolveOpencodeModelDiscoveryAgent(
    agent: AgentFlavor | null | undefined
): OpencodeModelDiscoveryAgent {
    return agent === 'omp' ? 'omp' : 'opencode'
}

function getOpencodeModelsError(
    data: OpencodeModelsResponse | undefined,
    error: unknown
): string | null {
    if (data?.success === false) {
        return data.error ?? 'Failed to load agent models'
    }
    if (error instanceof Error) {
        return error.message
    }
    if (error) {
        return 'Failed to load agent models'
    }
    return null
}

export function useOpencodeModelsForCwd(args: {
    api: ApiClient | null
    machineId?: string | null
    cwd?: string | null
    agent?: AgentFlavor | null
    enabled?: boolean
}): {
    availableModels: OpencodeModelSummary[]
    currentModelId: string | null
    isLoading: boolean
    error: string | null
    refetch: () => void
} {
    const { api, machineId, cwd } = args
    const agent = resolveOpencodeModelDiscoveryAgent(args.agent)
    const trimmedCwd = typeof cwd === 'string' ? cwd.trim() : ''
    const enabled = Boolean(args.enabled && api && machineId && trimmedCwd)

    const query = useQuery({
        queryKey: machineId && trimmedCwd
            ? queryKeys.machineOpencodeModelsForCwd(machineId, trimmedCwd, agent)
            : ['machine-opencode-models', 'unknown', 'unknown', agent] as const,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!machineId || !trimmedCwd) {
                throw new Error('Agent models target unavailable')
            }
            return await api.getMachineOpencodeModelsForCwd(machineId, trimmedCwd, agent)
        },
        enabled,
        staleTime: 60_000,
        retry: false,
    })

    return {
        availableModels: query.data?.availableModels ?? [],
        currentModelId: query.data?.currentModelId ?? null,
        isLoading: query.isLoading,
        error: getOpencodeModelsError(query.data, query.error),
        refetch: () => {
            void query.refetch()
        }
    }
}
