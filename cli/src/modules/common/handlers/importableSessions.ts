import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { listImportableClaudeSessions, resolveImportableClaudeSession } from '@/claude/utils/importableSessionCatalog'
import { listImportableCodexSessions, resolveImportableCodexSession } from '@/codex/utils/importableSessionCatalog'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { ListImportableSessionsRequest, ListImportableSessionsResponse, ResolveImportableSessionRequest, ResolveImportableSessionResponse } from '@hapi/protocol/apiTypes'

export function registerImportableSessionHandlers(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<ListImportableSessionsRequest, ListImportableSessionsResponse>(
        RPC_METHODS.ListImportableSessions,
        async (request) => request.provider === 'codex'
            ? listImportableCodexSessions(request.cursor)
            : listImportableClaudeSessions(request.cursor)
    )
    rpcHandlerManager.registerHandler<ResolveImportableSessionRequest, ResolveImportableSessionResponse>(
        RPC_METHODS.ResolveImportableSession,
        async (request) => {
            const session = request.provider === 'codex'
                ? await resolveImportableCodexSession(request.externalSessionId)
                : await resolveImportableClaudeSession(request.externalSessionId)
            return session ? { type: 'success', session } : { type: 'not-found' }
        }
    )
}
