import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

/**
 * 切换 cc-switch 供应商,并(按需)重启当前会话使新供应商生效。
 *
 * cc-switch 切换供应商 = 改写 ANTHROPIC_BASE_URL/AUTH_TOKEN 到本地 ~/.claude/settings.json,
 * 这是进程级动作,运行中的 agent 进程不会热加载新 env。因此切换后通过 resume 重启会话,
 * 新 spawn 的 claude 进程读到更新后的 settings.json,新供应商即生效。
 */
export function useCcSwitchProvider(args: {
    api: ApiClient | null
    machineId: string | null
    sessionId: string | null
}): {
    switchProvider: (providerId: string) => Promise<void>
    isPending: boolean
} {
    const { api, machineId, sessionId } = args
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (providerId: string) => {
            if (!api || !machineId) {
                throw new Error('cc-switch target unavailable')
            }
            const result = await api.switchMachineCcSwitchProvider(machineId, providerId)
            if (!result.success) {
                throw new Error(result.error ?? 'Failed to switch cc-switch provider')
            }
            // Runner 等待旧进程树完全退出后再 resume，避免 archive/reopen 的异步清理竞争。
            // 无会话(如新建页)只切换配置,下次启动自然生效。
            if (sessionId) {
                await api.restartSession(sessionId)
            }
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
