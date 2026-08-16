import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

/**
 * 为当前 session 选择 cc-switch provider，并重启该 session。
 * Runner 在本机只读 provider 配置并把 env 注入新子进程；不修改 settings.json 或 cc-switch DB。
 */
export function useCcSwitchProvider(args: {
    api: ApiClient | null
    machineId: string | null
    sessionId: string | null
}): {
    switchProvider: (providerId: string) => Promise<string>
    isPending: boolean
} {
    const { api, machineId, sessionId } = args
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (providerId: string) => {
            if (!api || !machineId) {
                throw new Error('cc-switch target unavailable')
            }
            if (!sessionId) throw new Error('cc-switch requires an active session')
            return await api.restartSession(sessionId, providerId)
        },
        onSuccess: async () => {
            if (machineId) {
                await queryClient.invalidateQueries({
                    queryKey: queryKeys.machineCcSwitchProviders(machineId)
                })
            }
            if (sessionId) {
                await queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
                await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            }
        },
    })

    return {
        switchProvider: mutation.mutateAsync,
        isPending: mutation.isPending,
    }
}
