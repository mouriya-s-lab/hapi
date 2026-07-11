import { logger } from '@/ui/logger';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import type {
    ListCcSwitchProvidersResponse
} from '@hapi/protocol/apiTypes';
import { listCcSwitchProviders } from '../ccSwitch';
import { getErrorMessage, rpcError } from '../rpcResponses';

export function registerCcSwitchHandlers(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<Record<string, never>, ListCcSwitchProvidersResponse>(
        RPC_METHODS.ListCcSwitchProviders,
        async () => {
            try {
                const { available, providers } = listCcSwitchProviders();
                return { success: true, available, providers };
            } catch (error) {
                logger.debug('Failed to list cc-switch providers:', error);
                return rpcError(getErrorMessage(error, 'Failed to list cc-switch providers'));
            }
        }
    );
}
