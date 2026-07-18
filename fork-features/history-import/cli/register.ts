import type { RpcHandlerManager } from '../../../cli/src/api/rpc/RpcHandlerManager'
import { listImportableClaudeSessions } from './claudeCatalog'
import { listImportableCodexSessions } from './codexCatalog'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { ImportProviderSessionRequest, ImportProviderSessionResponse, ListImportableSessionsRequest, ListImportableSessionsResponse } from '@hapi/protocol/apiTypes'
import { importProviderSession } from './importProviderSession'

export function registerImportableSessionHandlers(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<ListImportableSessionsRequest, ListImportableSessionsResponse>(
        RPC_METHODS.ListImportableSessions,
        async (request) => request.provider === 'codex'
            ? listImportableCodexSessions(request)
            : listImportableClaudeSessions(request)
    )
    rpcHandlerManager.registerHandler<ImportProviderSessionRequest, ImportProviderSessionResponse>(
        RPC_METHODS.ImportProviderSession,
        importProviderSession
    )
}
