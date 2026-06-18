import { logger } from '@/ui/logger';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import type {
    ListImportableSessionsResponse,
    ReadImportableSessionRequest,
    ReadImportableSessionResponse
} from '@hapi/protocol/apiTypes';
import { listImportableSessions, readImportableSession } from '../importSessions';
import { getErrorMessage, rpcError } from '../rpcResponses';

export function registerImportHandlers(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<Record<string, never>, ListImportableSessionsResponse>(
        RPC_METHODS.ListImportableSessions,
        async () => {
            try {
                const sessions = listImportableSessions();
                return { success: true, sessions };
            } catch (error) {
                logger.debug('Failed to list importable sessions:', error);
                return rpcError(getErrorMessage(error, 'Failed to list importable sessions'));
            }
        }
    );

    rpcHandlerManager.registerHandler<ReadImportableSessionRequest, ReadImportableSessionResponse>(
        RPC_METHODS.ReadImportableSession,
        async (data) => {
            const flavor = data?.flavor === 'codex' ? 'codex' : 'claude';
            const file = typeof data?.file === 'string' ? data.file : '';
            if (!file) {
                return { success: false, error: 'file is required' };
            }
            try {
                return readImportableSession({ flavor, file });
            } catch (error) {
                logger.debug('Failed to read importable session:', error);
                return { success: false, error: getErrorMessage(error, 'Failed to read importable session') };
            }
        }
    );
}
