import React from 'react';
import { logger } from '@/ui/logger';
import { buildHapiMcpBridge } from '@/codex/utils/buildHapiMcpBridge';
import { convertAgentMessage } from '@/agent/messageConverter';
import type { AgentMessage, McpServerStdio, PromptContent } from '@/agent/types';
import { RemoteLauncherBase, type RemoteLauncherDisplayContext, type RemoteLauncherExitReason } from '@/modules/common/remote/RemoteLauncherBase';
import { GrokDisplay } from '@/ui/ink/GrokDisplay';
import type { GrokSession } from './session';
import type { PermissionMode } from './types';
import { createGrokBackend } from './utils/grokBackend';
import { GrokPermissionHandler } from './utils/permissionHandler';
import { parseRuntimeConfigRequest, resolveRuntimeConfigRequest } from './runtimeConfigState';

const GROK_DEFAULT_REASONING_EFFORT = 'high';

export function getGrokAuthPreference(env: NodeJS.ProcessEnv): readonly string[] {
    return env.XAI_API_KEY ? ['xai.api_key', 'cached_token'] : ['cached_token', 'xai.api_key'];
}

class GrokRemoteLauncher extends RemoteLauncherBase {
    private readonly session: GrokSession;
    private readonly model?: string;
    private backend: ReturnType<typeof createGrokBackend> | null = null;
    private permissionHandler: GrokPermissionHandler | null = null;
    private happyServer: { stop: () => void } | null = null;
    private abortController = new AbortController();
    private displayModel: string | null = null;
    private displayPermissionMode: PermissionMode | null = null;
    private currentBackendModel: string | null = null;
    private defaultBackendModel: string | null = null;
    private setModelSupported: boolean | undefined = undefined;
    private currentEffort: string | null = null;
    private lastDisplayedToolCall = new Map<string, string>();

    constructor(session: GrokSession, private readonly opts: {
        model?: string;
        onModelRollback?: (model: string | null) => void;
        onReasoningEffortRollback?: (effort: string | null) => void;
    }) {
        super(process.env.DEBUG ? session.logPath : undefined);
        this.session = session;
        this.model = opts.model;
    }

    public async launch(): Promise<RemoteLauncherExitReason> {
        return this.start({
            onExit: () => this.handleExitFromUi(),
            onSwitchToLocal: () => this.handleSwitchFromUi()
        });
    }

    protected createDisplay(context: RemoteLauncherDisplayContext): React.ReactElement {
        return React.createElement(GrokDisplay, context);
    }

    protected async runMainLoop(): Promise<void> {
        const session = this.session;
        const messageBuffer = this.messageBuffer;

        const { server: happyServer, mcpServers } = await buildHapiMcpBridge(session.client);
        this.happyServer = happyServer;

        this.displayModel = this.model ?? null;
        if (this.model) messageBuffer.addMessage(`[MODEL:${this.model}]`, 'system');

        const backend = createGrokBackend({
            model: this.model,
            cwd: session.path,
            permissionMode: session.getPermissionMode() as string | undefined
        });
        this.backend = backend;

        backend.onStderrError((error) => {
            logger.debug('[grok-remote] stderr error', error);
            session.sendSessionEvent({ type: 'message', message: error.message });
            messageBuffer.addMessage(error.message, 'status');
        });

        await backend.initialize();
        await backend.authenticateFirstAvailable(getGrokAuthPreference(process.env));

        const resumeSessionId = session.sessionId;
        const acpMcpServers = toAcpMcpServers(mcpServers);
        let acpSessionId: string;
        if (resumeSessionId) {
            acpSessionId = await backend.loadSession({
                sessionId: resumeSessionId,
                cwd: session.path,
                mcpServers: acpMcpServers
            });
        } else {
            acpSessionId = await backend.newSession({
                cwd: session.path,
                mcpServers: acpMcpServers
            });
        }
        session.onSessionFound(acpSessionId);

        this.permissionHandler = new GrokPermissionHandler(
            session.client,
            backend,
            () => session.getPermissionMode() as PermissionMode | undefined
        );
        this.currentBackendModel = backend.getSessionModelsMetadata(acpSessionId)?.currentModelId ?? this.model ?? null;
        this.defaultBackendModel = this.currentBackendModel;
        this.applyDisplayMode(session.getPermissionMode() as PermissionMode, this.currentBackendModel ?? undefined);

        this.setupAbortHandlers(session.client.rpcHandlerManager, {
            onAbort: () => this.handleAbort(),
            onSwitch: () => this.handleSwitchRequest()
        });

        const sendReady = () => {
            session.sendSessionEvent({ type: 'ready' });
        };

        while (!this.shouldExit) {
            const waitSignal = this.abortController.signal;
            const batch = await session.queue.waitForMessagesAndGetAsString(waitSignal);
            if (!batch) {
                if (waitSignal.aborted && !this.shouldExit) {
                    continue;
                }
                break;
            }

            const modelRequest = parseRuntimeConfigRequest(batch.mode.model);
            const requestedModel = resolveRuntimeConfigRequest(modelRequest, this.defaultBackendModel);
            if (modelRequest.kind === 'reset' && requestedModel === null && this.currentBackendModel !== null) {
                session.sendSessionEvent({
                    type: 'message',
                    message: `Grok did not report its default model. Continuing with ${this.currentBackendModel}.`
                });
                batch.mode.model = this.currentBackendModel;
                this.opts.onModelRollback?.(this.currentBackendModel);
            }
            if (requestedModel && requestedModel !== this.currentBackendModel) {
                if (!backend.setModel || this.setModelSupported === false) {
                    batch.mode.model = this.currentBackendModel ?? undefined;
                    this.opts.onModelRollback?.(this.currentBackendModel);
                } else {
                    logger.debug(`[grok-remote] Switching model inline: ${this.currentBackendModel} -> ${requestedModel}`);
                    try {
                        await backend.setModel(acpSessionId, requestedModel);
                        this.currentBackendModel = requestedModel;
                        this.setModelSupported = true;
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        const methodNotFound = /method not found/i.test(message);
                        if (methodNotFound && this.setModelSupported === undefined) {
                            this.setModelSupported = false;
                            logger.warn('[grok-remote] Grok CLI build does not support set_session_model; inline switching disabled for this session');
                            session.sendSessionEvent({
                                type: 'message',
                                message: 'This Grok CLI build does not support inline model switching. Restart the session to apply a different model.'
                            });
                        } else {
                            logger.warn('[grok-remote] Inline model switch failed', error);
                            session.sendSessionEvent({
                                type: 'message',
                                message: `Failed to switch model to ${requestedModel}. Continuing with ${this.currentBackendModel}.`
                            });
                        }
                        batch.mode.model = this.currentBackendModel ?? undefined;
                        this.opts.onModelRollback?.(this.currentBackendModel);
                    }
                }
            }

            const effortRequest = parseRuntimeConfigRequest(batch.mode.modelReasoningEffort);
            const effortSupported = this.currentBackendModel === 'grok-4.5';
            if (!effortSupported && (this.currentEffort !== null || effortRequest.kind === 'set')) {
                this.currentEffort = null;
                batch.mode.modelReasoningEffort = null;
                this.opts.onReasoningEffortRollback?.(null);
            }
            const wireEffort = effortSupported
                ? resolveRuntimeConfigRequest(effortRequest, GROK_DEFAULT_REASONING_EFFORT)
                : undefined;
            if (wireEffort != null && (
                effortRequest.kind === 'reset'
                    ? this.currentEffort !== null
                    : wireEffort !== this.currentEffort
            )) {
                try {
                    await backend.setMode(acpSessionId, wireEffort);
                    this.currentEffort = effortRequest.kind === 'reset' ? null : wireEffort;
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    session.sendSessionEvent({
                        type: 'message',
                        message: `Grok rejected reasoning effort ${wireEffort}: ${message}`
                    });
                    batch.mode.modelReasoningEffort = this.currentEffort;
                    this.opts.onReasoningEffortRollback?.(this.currentEffort);
                }
            }

            this.applyDisplayMode(batch.mode.permissionMode, this.currentBackendModel ?? undefined);
            messageBuffer.addMessage(batch.message, 'user');

            const promptContent: PromptContent[] = [{
                type: 'text',
                text: batch.message
            }];

            session.onThinkingChange(true);

            try {
                await backend.prompt(acpSessionId, promptContent, (message: AgentMessage) => {
                    this.handleAgentMessage(message);
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.warn('[grok-remote] prompt failed', { message: errorMessage });
                session.sendSessionEvent({
                    type: 'message',
                    message: `Grok prompt failed: ${errorMessage}`
                });
                messageBuffer.addMessage(`Grok prompt failed: ${errorMessage}`, 'status');
            } finally {
                session.onThinkingChange(false);
                await this.permissionHandler?.cancelAll('Prompt finished');
                if (session.queue.size() === 0 && !this.shouldExit) {
                    sendReady();
                }
            }
        }
    }

    protected async cleanup(): Promise<void> {
        this.clearAbortHandlers(this.session.client.rpcHandlerManager);

        if (this.permissionHandler) {
            await this.permissionHandler.cancelAll('Session ended');
            this.permissionHandler = null;
        }

        if (this.backend) {
            await this.backend.disconnect();
            this.backend = null;
        }

        if (this.happyServer) {
            this.happyServer.stop();
            this.happyServer = null;
        }
    }

    private handleAgentMessage(message: AgentMessage): void {
        const converted = convertAgentMessage(message);
        if (converted) {
            this.session.sendAgentMessage(converted);
        }

        switch (message.type) {
            case 'text':
                this.messageBuffer.addMessage(message.text, 'assistant');
                break;
            case 'reasoning':
                this.messageBuffer.addMessage(`[Thinking] ${message.text.substring(0, 100)}...`, 'system');
                break;
            case 'tool_call': {
                const lastName = this.lastDisplayedToolCall.get(message.id);
                if (lastName !== message.name) {
                    this.messageBuffer.addMessage(`Tool call: ${message.name}`, 'tool');
                    this.lastDisplayedToolCall.set(message.id, message.name);
                }
                break;
            }
            case 'tool_result':
                this.messageBuffer.addMessage('Tool result received', 'result');
                break;
            case 'usage':
                break;
            case 'plan':
                this.messageBuffer.addMessage('Plan updated', 'status');
                break;
            case 'error':
                this.messageBuffer.addMessage(message.message, 'status');
                break;
            case 'generated_image':
                this.messageBuffer.addMessage(`Generated image: ${message.fileName}`, 'assistant');
                break;
            case 'turn_complete':
                this.messageBuffer.addMessage('Turn complete', 'status');
                break;
            default: {
                const _exhaustive: never = message;
                return _exhaustive;
            }
        }
    }

    private applyDisplayMode(permissionMode: PermissionMode | undefined, model?: string): void {
        if (permissionMode && permissionMode !== this.displayPermissionMode) {
            this.displayPermissionMode = permissionMode;
            this.messageBuffer.addMessage(`[MODE:${permissionMode}]`, 'system');
        }
        if (model && model !== this.displayModel) {
            this.displayModel = model;
            this.messageBuffer.addMessage(`[MODEL:${model}]`, 'system');
        }
    }

    private async handleAbort(): Promise<void> {
        const backend = this.backend;
        if (backend && this.session.sessionId) {
            await backend.cancelPrompt(this.session.sessionId);
        }
        await this.permissionHandler?.cancelAll('User aborted');
        this.session.sendSessionEvent({ type: 'message', message: 'Session aborted' });
        this.session.queue.reset();
        this.session.onThinkingChange(false);
        this.abortController.abort();
        this.abortController = new AbortController();
        this.messageBuffer.addMessage('Turn aborted', 'status');
    }

    private async handleExitFromUi(): Promise<void> {
        await this.requestExit('exit', () => this.handleAbort());
    }

    private async handleSwitchFromUi(): Promise<void> {
        await this.requestExit('switch', () => this.handleAbort());
    }

    private async handleSwitchRequest(): Promise<void> {
        await this.requestExit('switch', () => this.handleAbort());
    }
}

function toAcpMcpServers(config: Record<string, { command: string; args: string[] }>): McpServerStdio[] {
    return Object.entries(config).map(([name, entry]) => ({
        name,
        command: entry.command,
        args: entry.args,
        env: []
    }));
}

export async function grokRemoteLauncher(
    session: GrokSession,
    opts: {
        model?: string;
        onModelRollback?: (model: string | null) => void;
        onReasoningEffortRollback?: (effort: string | null) => void;
    }
): Promise<'switch' | 'exit'> {
    const launcher = new GrokRemoteLauncher(session, opts);
    return launcher.launch();
}
