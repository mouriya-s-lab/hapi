import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { CcSwitchUsageResult } from '@hapi/protocol'
import { queryKeys } from '@/lib/query-keys'

/**
 * 查询指定机器上当前(或指定)cc-switch 供应商的剩余用量。
 * 用量通过本地执行供应商的 usage_script 获取(token 不出本机),只回传脱敏后的余额数字。
 * providerId 省略时查询当前选中供应商。
 */
export function useCcSwitchUsage(args: {
    api: ApiClient | null
    machineId?: string | null
    providerId?: string | null
    enabled?: boolean
}): {
    providerName: string | null
    usage: CcSwitchUsageResult | null
    isLoading: boolean
    error: string | null
    refetch: () => void
} {
    const { api, machineId, providerId } = args
    const enabled = Boolean(args.enabled && api && machineId)

    const query = useQuery({
        queryKey: machineId
            ? queryKeys.machineCcSwitchUsage(machineId, providerId ?? 'current')
            : ['machine-cc-switch-usage', 'unknown'] as const,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!machineId) {
                throw new Error('cc-switch target unavailable')
            }
            return await api.getMachineCcSwitchUsage(machineId, providerId ?? undefined)
        },
        enabled,
        // 用量变化不频繁,且查询要远程打供应商 API;5 分钟刷新一次,避免频繁请求。
        staleTime: 5 * 60_000,
        refetchInterval: 5 * 60_000,
        retry: false,
    })

    return {
        providerName: query.data?.providerName ?? null,
        usage: query.data?.success === true ? (query.data.usage ?? null) : null,
        isLoading: query.isLoading,
        error: query.data?.success === false
            ? (query.data.error ?? 'Failed to query cc-switch usage')
            : query.error instanceof Error
                ? query.error.message
                : null,
        refetch: () => {
            void query.refetch()
        }
    }
}
