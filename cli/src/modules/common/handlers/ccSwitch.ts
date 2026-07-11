import { logger } from '@/ui/logger';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import type {
    ListCcSwitchProvidersResponse,
    SwitchCcSwitchProviderRequest,
    SwitchCcSwitchProviderResponse,
    QueryCcSwitchUsageResponse
} from '@hapi/protocol/apiTypes';
import { listCcSwitchProviders, switchCcSwitchProvider, queryCcSwitchUsage } from '../ccSwitch';
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

    rpcHandlerManager.registerHandler<{ providerId?: string }, QueryCcSwitchUsageResponse>(
        RPC_METHODS.QueryCcSwitchUsage,
        async (data) => {
            try {
                const result = await queryCcSwitchUsage(data?.providerId);
                if (result.error && !result.usage) {
                    return { success: false, providerName: result.providerName, error: result.error };
                }
                return { success: true, providerName: result.providerName, usage: result.usage };
            } catch (error) {
                logger.debug('Failed to query cc-switch usage:', error);
                return rpcError(getErrorMessage(error, 'Failed to query cc-switch usage'));
            }
        }
    );
}
