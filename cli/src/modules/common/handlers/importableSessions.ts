import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { ListImportableSessionsRequest, ListImportableSessionsResponse, ResolveImportableSessionRequest, ResolveImportableSessionResponse } from '@hapi/protocol/apiTypes'
import { listImportableSessions, resolveImportableSession, resolveImportableSessionPath } from '../importableSessions'

export function registerImportableSessionHandlers(manager: RpcHandlerManager): void {
    manager.registerHandler<ListImportableSessionsRequest, ListImportableSessionsResponse>(
        RPC_METHODS.ListImportableSessions,
        async (request) => await listImportableSessions(request)
    )
    manager.registerHandler<ResolveImportableSessionRequest, ResolveImportableSessionResponse>(
        RPC_METHODS.ResolveImportableSession,
        async (request) => {
            const session = resolveImportableSession(request.agent, request.externalSessionId)
            const transcriptPath = resolveImportableSessionPath(request.agent, request.externalSessionId)
            return session && transcriptPath ? { type: 'success', session, transcriptPath } : { type: 'error', error: 'Session was not listed by this machine' }
        }
    )
}
