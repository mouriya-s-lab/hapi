import { logger } from '@/ui/logger';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import {
    listOpencodeModelsForCwd,
    resolveAcpModelDiscoveryAgent,
    type ListOpencodeModelsForCwdRequest,
    type ListOpencodeModelsForCwdResponse
} from '../opencodeModels';
import { getErrorMessage, rpcError } from '../rpcResponses';

export function registerOpencodeModelHandlers(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<ListOpencodeModelsForCwdRequest, ListOpencodeModelsForCwdResponse>(
        RPC_METHODS.ListOpencodeModelsForCwd,
        async (data) => {
            logger.debug('List OpenCode models for cwd request', { cwd: data?.cwd, agent: data?.agent });

            try {
                const cwd = typeof data?.cwd === 'string' ? data.cwd : '';
                const agent = resolveAcpModelDiscoveryAgent(data?.agent);
                return await listOpencodeModelsForCwd(cwd, { agent });
            } catch (error) {
                logger.debug('Failed to list OpenCode models:', error);
                return rpcError(getErrorMessage(error, 'Failed to list OpenCode models'));
            }
        }
    );
}
