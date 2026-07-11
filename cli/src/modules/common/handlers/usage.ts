import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { ListUsageProvidersResponse, QueryUsageRequest, QueryUsageResponse } from '@hapi/protocol/apiTypes'
import { getUsageProviderAdapter, listUsageProviderAdapters } from '../usage/registry'
import { getErrorMessage, rpcError } from '../rpcResponses'

export function registerUsageHandlers(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<Record<string, never>, ListUsageProvidersResponse>(
        RPC_METHODS.ListUsageProviders,
        async () => ({
            success: true,
            providers: await Promise.all(listUsageProviderAdapters().map((provider) => provider.inspect()))
        })
    )

    rpcHandlerManager.registerHandler<QueryUsageRequest, QueryUsageResponse>(
        RPC_METHODS.QueryUsage,
        async (request) => {
            if (!request?.providerId) return rpcError('providerId is required')
            try {
                const snapshot = await getUsageProviderAdapter(request.providerId).query({ subjectId: request.subjectId })
                return { success: true, snapshot }
            } catch (error) {
                return rpcError(getErrorMessage(error, 'Failed to query usage'))
            }
        }
    )
}
