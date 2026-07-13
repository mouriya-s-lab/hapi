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
import type { GrokSessionController } from './sessionController';

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
    private unbindRemoteModelTransport: (() => void) | null = null;
    private lastDisplayedToolCall = new Map<string, string>();

    constructor(session: GrokSession, private readonly opts: {
        model?: string;
        controller: GrokSessionController;
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
            permissionMode: session.getPermissionMode() as string | undefined,
            reasoningEffort: session.sessionId === null ? session.getModelReasoningEffort() : null
        });
        this.backend = backend;

        backend.onStderrError((error) => {
            logger.debug('[grok-remote] stderr error', error);
            session.sendSessionEvent({ type: 'message', message: error.message });
            messageBuffer.addMessage(error.message, 'status');
        });

        await backend.initialize();

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
        this.opts.controller.commitSessionId(acpSessionId);

        this.permissionHandler = new GrokPermissionHandler(
            session.client,
            backend,
            () => session.getPermissionMode() as PermissionMode | undefined
        );
        this.currentBackendModel = backend.getSessionModelsMetadata(acpSessionId)?.currentModelId ?? null;
        this.unbindRemoteModelTransport = this.opts.controller.bindRemoteModelTransport({
            currentModelId: this.currentBackendModel,
            setModel: async (modelId) => {
                await backend.setModel(acpSessionId, modelId);
                this.currentBackendModel = modelId;
                this.applyDisplayMode(session.getPermissionMode() as PermissionMode, modelId);
            }
        });
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
        this.unbindRemoteModelTransport?.();
        this.unbindRemoteModelTransport = null;

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
        controller: GrokSessionController;
        onModelRollback?: (model: string | null) => void;
        onReasoningEffortRollback?: (effort: string | null) => void;
    }
): Promise<'switch' | 'exit'> {
    const launcher = new GrokRemoteLauncher(session, opts);
    return launcher.launch();
}
