import { logger } from '@/ui/logger';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import type {
    ListCcSwitchProvidersResponse,
    SwitchCcSwitchProviderRequest,
    SwitchCcSwitchProviderResponse
} from '@hapi/protocol/apiTypes';
import { listCcSwitchProviders, switchCcSwitchProvider } from '../ccSwitch';
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

    rpcHandlerManager.registerHandler<SwitchCcSwitchProviderRequest, SwitchCcSwitchProviderResponse>(
        RPC_METHODS.SwitchCcSwitchProvider,
        async (data) => {
            const providerId = typeof data?.providerId === 'string' ? data.providerId : '';
            if (!providerId) {
                return rpcError('providerId is required');
            }
            try {
                return switchCcSwitchProvider(providerId);
            } catch (error) {
                logger.debug('Failed to switch cc-switch provider:', error);
                return rpcError(getErrorMessage(error, 'Failed to switch cc-switch provider'));
            }
        }
    );
}
