import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { RpcHandlerManager } from '../../cli/src/api/rpc/RpcHandlerManager';
import {
    assertSupportedOmpVersion,
    OmpRpcClient,
    probeOmpVersion,
    type OmpVersion
} from '../../cli/src/omp/rpc/OmpRpcClient';
import type {
    JsonObject,
    OmpInboundEvent,
    OmpRpcSpawnConfig
} from '../../cli/src/omp/rpc/types';
import { buildOmpEnv } from '../../cli/src/omp/utils/config';
import type {
    OmpLoginFlow,
    OmpLoginProvidersResponse,
    OmpModelSummary,
    OmpModelsResponse,
    RespondOmpLoginInputRequest,
    RespondOmpLoginInputResponse,
    StartOmpLoginRequest,
    StartOmpLoginResponse
} from '@hapi/protocol/apiTypes';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';

const StartLoginRequestSchema = z.object({ providerId: z.string().trim().min(1) });
const RespondLoginInputRequestSchema = z.object({
    flowId: z.string().uuid(),
    value: z.string().min(1)
});
const LoginUiEventSchema = z.discriminatedUnion('method', [
    z.object({
        type: z.literal('extension_ui_request'),
        id: z.string(),
        method: z.literal('open_url'),
        url: z.string(),
        launchUrl: z.string().optional(),
        instructions: z.string().optional()
    }),
    z.object({
        type: z.literal('extension_ui_request'),
        id: z.string(),
        method: z.literal('input'),
        title: z.string(),
        placeholder: z.string().optional()
    }),
    z.object({
        type: z.literal('extension_ui_request'),
        id: z.string(),
        method: z.literal('cancel'),
        targetId: z.string()
    })
]);

const LOGIN_TIMEOUT_MS = 10 * 60_000;
const LOGIN_START_TIMEOUT_MS = 15_000;

type OmpMachineClient = Pick<
    OmpRpcClient,
    'discovery' | 'request' | 'sendControlFrame' | 'onEvent' | 'close'
>;

type ActiveLogin = {
    client: OmpMachineClient;
    flow: OmpLoginFlow;
    inputRequestId: string | null;
};

type OmpMachineIntegrationOptions = {
    defaultCwd: string;
    resolveModelCwd: (cwd: string) => Promise<string>;
    connect?: (config: OmpRpcSpawnConfig) => Promise<OmpMachineClient>;
};

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function safeWebUrl(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined;
    } catch {
        return undefined;
    }
}

function toModelSummary(model: OmpMachineClient['discovery']['models'][number]): OmpModelSummary {
    return {
        provider: model.provider,
        modelId: model.id,
        name: model.name,
        reasoning: model.reasoning,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        thinkingLevels: model.thinking?.efforts ?? []
    };
}

export type OmpMachineAvailability =
    | { available: true; version: OmpVersion }
    | { available: false; error: string };

export async function detectOmpMachineAvailability(
    probe: () => Promise<OmpVersion> = () => probeOmpVersion('omp', buildOmpEnv())
): Promise<OmpMachineAvailability> {
    try {
        const version = await probe();
        assertSupportedOmpVersion(version);
        return { available: true, version };
    } catch (error) {
        return { available: false, error: errorText(error) };
    }
}

export class OmpMachineIntegration {
    private readonly connect: (config: OmpRpcSpawnConfig) => Promise<OmpMachineClient>;
    private activeLogin: ActiveLogin | null = null;
    private lastFlow: OmpLoginFlow | null = null;

    constructor(private readonly options: OmpMachineIntegrationOptions) {
        this.connect = options.connect ?? ((config) => OmpRpcClient.connect(config));
    }

    register(rpcHandlerManager: RpcHandlerManager): void {
        rpcHandlerManager.registerHandler<Record<string, never>, OmpLoginProvidersResponse>(
            RPC_METHODS.ListOmpLoginProviders,
            async () => await this.listLoginProviders()
        );
        rpcHandlerManager.registerHandler<StartOmpLoginRequest, StartOmpLoginResponse>(
            RPC_METHODS.StartOmpLogin,
            async (request) => await this.startLogin(request)
        );
        rpcHandlerManager.registerHandler<RespondOmpLoginInputRequest, RespondOmpLoginInputResponse>(
            RPC_METHODS.RespondOmpLoginInput,
            async (request) => await this.respondToLoginInput(request)
        );
        rpcHandlerManager.registerHandler<{ cwd?: string }, OmpModelsResponse>(
            RPC_METHODS.ListOmpModels,
            async (request) => await this.listModels(request?.cwd)
        );
    }

    async shutdown(): Promise<void> {
        const active = this.activeLogin;
        this.activeLogin = null;
        if (active) {
            await active.client.close(new Error('OMP machine integration stopped'));
        }
    }

    private async listLoginProviders(): Promise<OmpLoginProvidersResponse> {
        try {
            const client = this.activeLogin?.client ?? await this.connectClient(this.options.defaultCwd);
            try {
                const result = await client.request({ type: 'get_login_providers' });
                return {
                    success: true,
                    providers: result.providers,
                    flow: this.activeLogin?.flow ?? this.lastFlow
                };
            } finally {
                if (client !== this.activeLogin?.client) {
                    await client.close();
                }
            }
        } catch (error) {
            return { success: false, error: errorText(error) };
        }
    }

    private async listModels(rawCwd: string | undefined): Promise<OmpModelsResponse> {
        const cwd = rawCwd?.trim();
        if (!cwd) return { success: false, error: 'cwd is required' };
        try {
            const resolvedCwd = await this.options.resolveModelCwd(cwd);
            const client = await this.connectClient(resolvedCwd);
            try {
                const [catalog, state] = await Promise.all([
                    client.request({ type: 'get_available_models' }),
                    client.request({ type: 'get_state' })
                ]);
                return {
                    success: true,
                    availableModels: catalog.models.map(toModelSummary),
                    currentModel: state.model
                        ? { provider: state.model.provider, modelId: state.model.id }
                        : null
                };
            } finally {
                await client.close();
            }
        } catch (error) {
            return { success: false, error: errorText(error) };
        }
    }

    private async startLogin(raw: StartOmpLoginRequest): Promise<StartOmpLoginResponse> {
        const parsed = StartLoginRequestSchema.safeParse(raw);
        if (!parsed.success) return { success: false, error: 'Invalid OMP login request' };
        if (this.activeLogin) return { success: false, error: 'An OMP provider login is already in progress' };

        let client: OmpMachineClient | null = null;
        try {
            client = await this.connectClient(this.options.defaultCwd);
            const providers = await client.request({ type: 'get_login_providers' });
            const provider = providers.providers.find((candidate) => candidate.id === parsed.data.providerId);
            if (!provider?.available) {
                await client.close();
                return { success: false, error: `OMP login provider is unavailable: ${parsed.data.providerId}` };
            }
            if (provider.authenticated) {
                await client.close();
                const flow: OmpLoginFlow = {
                    flowId: randomUUID(),
                    providerId: provider.id,
                    providerName: provider.name,
                    status: 'authenticated'
                };
                this.lastFlow = flow;
                return { success: true, flow };
            }

            const flowId = randomUUID();
            const firstUpdate = Promise.withResolvers<OmpLoginFlow>();
            let firstUpdateSent = false;
            const publish = (flow: OmpLoginFlow) => {
                const active = this.activeLogin;
                if (!active || active.flow.flowId !== flowId) return;
                active.flow = flow;
                this.lastFlow = flow;
                if (!firstUpdateSent) {
                    firstUpdateSent = true;
                    firstUpdate.resolve(flow);
                }
            };
            const initialFlow: OmpLoginFlow = {
                flowId,
                providerId: provider.id,
                providerName: provider.name,
                status: 'authenticating'
            };
            this.activeLogin = { client, flow: initialFlow, inputRequestId: null };
            this.lastFlow = initialFlow;

            const removeListener = client.onEvent((event) => {
                this.handleLoginEvent(event, flowId, provider.id, provider.name, publish);
            });
            const startTimeout = setTimeout(() => {
                publish({
                    flowId,
                    providerId: provider.id,
                    providerName: provider.name,
                    status: 'failed',
                    error: 'OMP login did not provide a browser URL or input prompt'
                });
                void client?.close(new Error('OMP login start timed out'));
            }, LOGIN_START_TIMEOUT_MS);
            startTimeout.unref();

            void client.request(
                { type: 'login', providerId: provider.id },
                { timeoutMs: LOGIN_TIMEOUT_MS }
            ).then(() => {
                publish({
                    flowId,
                    providerId: provider.id,
                    providerName: provider.name,
                    status: 'authenticated'
                });
            }).catch((error) => {
                publish({
                    flowId,
                    providerId: provider.id,
                    providerName: provider.name,
                    status: 'failed',
                    error: errorText(error)
                });
            }).finally(() => {
                clearTimeout(startTimeout);
                removeListener();
                if (this.activeLogin?.flow.flowId === flowId) this.activeLogin = null;
                void client?.close();
            });

            return { success: true, flow: await firstUpdate.promise };
        } catch (error) {
            if (client && client !== this.activeLogin?.client) await client.close();
            return { success: false, error: errorText(error) };
        }
    }

    private handleLoginEvent(
        event: OmpInboundEvent,
        flowId: string,
        providerId: string,
        providerName: string,
        publish: (flow: OmpLoginFlow) => void
    ): void {
        if (event.type !== 'extension_ui_request') return;
        const parsed = LoginUiEventSchema.safeParse(event.raw);
        if (!parsed.success) return;
        const active = this.activeLogin;
        if (!active || active.flow.flowId !== flowId) return;

        if (parsed.data.method === 'open_url') {
            const url = safeWebUrl(parsed.data.url);
            if (!url) {
                publish({ flowId, providerId, providerName, status: 'failed', error: 'OMP returned an invalid login URL' });
                void active.client.close(new Error('OMP returned an invalid login URL'));
                return;
            }
            publish({
                flowId,
                providerId,
                providerName,
                status: 'waiting_for_callback',
                url,
                launchUrl: safeWebUrl(parsed.data.launchUrl),
                instructions: parsed.data.instructions
            });
            return;
        }
        if (parsed.data.method === 'input') {
            active.inputRequestId = parsed.data.id;
            publish({
                flowId,
                providerId,
                providerName,
                status: 'waiting_for_input',
                title: parsed.data.title,
                placeholder: parsed.data.placeholder
            });
            return;
        }
        if (active.inputRequestId === parsed.data.targetId) {
            active.inputRequestId = null;
        }
    }

    private async respondToLoginInput(raw: RespondOmpLoginInputRequest): Promise<RespondOmpLoginInputResponse> {
        const parsed = RespondLoginInputRequestSchema.safeParse(raw);
        if (!parsed.success) return { success: false, error: 'Invalid OMP login input' };
        const active = this.activeLogin;
        if (
            !active
            || active.flow.flowId !== parsed.data.flowId
            || active.flow.status !== 'waiting_for_input'
            || !active.inputRequestId
        ) {
            return { success: false, error: 'OMP login is not waiting for input' };
        }

        await active.client.sendControlFrame({
            type: 'extension_ui_response',
            id: active.inputRequestId,
            value: parsed.data.value
        });
        active.inputRequestId = null;
        active.flow = {
            flowId: active.flow.flowId,
            providerId: active.flow.providerId,
            providerName: active.flow.providerName,
            status: 'authenticating'
        };
        this.lastFlow = active.flow;
        return { success: true, flow: active.flow };
    }

    private async connectClient(cwd: string): Promise<OmpMachineClient> {
        return await this.connect({
            cwd,
            env: buildOmpEnv(),
            noSession: true
        });
    }
}

export function registerOmpMachineHandlers(
    rpcHandlerManager: RpcHandlerManager,
    options: OmpMachineIntegrationOptions
): OmpMachineIntegration {
    const integration = new OmpMachineIntegration(options);
    integration.register(rpcHandlerManager);
    return integration;
}
