import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { CcSwitchProviderSummary } from '@hapi/protocol'
import { queryKeys } from '@/lib/query-keys'

/**
 * 列出指定机器上 cc-switch 配置的 Claude 供应商(gaccode/glm/deepseek/cx2cc 等)。
 * cc-switch 配置在本地机器,故经 machine-level RPC 读取;hub 在 ECS 时同样适用。
 * `available` 为 false 表示该机器没有 cc-switch(找不到 db),UI 应回退到内置模型选项。
 */
export function useCcSwitchProviders(args: {
    api: ApiClient | null
    machineId?: string | null
    enabled?: boolean
}): {
    providers: CcSwitchProviderSummary[]
    available: boolean
    currentProviderId: string | null
    isLoading: boolean
    error: string | null
    refetch: () => void
} {
    const { api, machineId } = args
    const enabled = Boolean(args.enabled && api && machineId)

    const query = useQuery({
        queryKey: machineId
            ? queryKeys.machineCcSwitchProviders(machineId)
            : ['machine-cc-switch-providers', 'unknown'] as const,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!machineId) {
                throw new Error('cc-switch target unavailable')
            }
            return await api.getMachineCcSwitchProviders(machineId)
        },
        enabled,
        staleTime: 60_000,
        retry: false,
    })

    const providers = query.data?.providers ?? []
    const currentProvider = providers.find((provider) => provider.isCurrent)

    return {
        providers,
        // 仅当后端明确报告找到 cc-switch 时才视为可用;请求失败/未就绪时按不可用回退。
        available: query.data?.success === true && query.data.available === true,
        currentProviderId: currentProvider?.id ?? null,
        isLoading: query.isLoading,
        error: query.data?.success === false
            ? (query.data.error ?? 'Failed to load cc-switch providers')
            : query.error instanceof Error
                ? query.error.message
                : query.error
                    ? 'Failed to load cc-switch providers'
                    : null,
        refetch: () => {
            void query.refetch()
        }
    }
}
