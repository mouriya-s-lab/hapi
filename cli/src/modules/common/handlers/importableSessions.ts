import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { ListImportableSessionsRequest, ListImportableSessionsResponse, ResolveImportableSessionRequest, ResolveImportableSessionResponse } from '@hapi/protocol/apiTypes'
import { listImportableSessions, resolveImportableSession, resolveImportableSessionPath } from '../importableSessions'

export function registerImportableSessionHandlers(manager: RpcHandlerManager, allowsCwd?: (cwd: string) => Promise<boolean>): void {
    manager.registerHandler<ListImportableSessionsRequest, ListImportableSessionsResponse>(
        RPC_METHODS.ListImportableSessions,
        async (request) => {
            const response = await listImportableSessions(request)
            if (!allowsCwd) return response
            const sessions = []
            for (const session of response.sessions) {
                if (session.cwd && await allowsCwd(session.cwd)) sessions.push(session)
            }
            return { ...response, sessions }
        }
    )
    manager.registerHandler<ResolveImportableSessionRequest, ResolveImportableSessionResponse>(
        RPC_METHODS.ResolveImportableSession,
        async (request) => {
            const session = resolveImportableSession(request.agent, request.externalSessionId)
            const transcriptPath = resolveImportableSessionPath(request.agent, request.externalSessionId)
            if (!session || !transcriptPath) return { type: 'error', error: 'Session was not listed by this machine' }
            if (!session.cwd || (allowsCwd && !await allowsCwd(session.cwd))) return { type: 'error', error: 'Session is outside this machine\'s workspace roots' }
            return { type: 'success', session, transcriptPath }
        }
    )
}
