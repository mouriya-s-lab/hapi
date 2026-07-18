import React from 'react';
import { logger } from '@/ui/logger';
import { convertAgentMessage } from '@/agent/messageConverter';
import {
    RemoteLauncherBase,
    type RemoteLauncherDisplayContext,
    type RemoteLauncherExitReason
} from '@/modules/common/remote/RemoteLauncherBase';
import { OmpDisplay } from '@/ui/ink/OmpDisplay';
import type { OmpSession } from './session';
import type { PermissionMode } from './types';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';
import { PLAN_MODE_INSTRUCTION } from './utils/systemPrompt';
import { buildOmpEnv } from './utils/config';
import { OmpRpcClient } from './rpc/OmpRpcClient';
import { OmpRpcEventAdapter } from './rpc/OmpRpcEventAdapter';
import type { OmpModel } from './rpc/types';

type TurnWaiter = {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
    settled: boolean;
};

function createTurnWaiter(): TurnWaiter {
    let resolvePromise!: () => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    const waiter: TurnWaiter = {
        promise,
        settled: false,
        resolve: () => {
            if (waiter.settled) {
                return;
            }
            waiter.settled = true;
            resolvePromise();
        },
        reject: (error) => {
            if (waiter.settled) {
                return;
            }
            waiter.settled = true;
            rejectPromise(error);
        }
    };
    return waiter;
}

class OmpRemoteLauncher extends RemoteLauncherBase {
    private readonly session: OmpSession;
    private client: OmpRpcClient | null = null;
    private queueAbortController = new AbortController();
    private currentTurn: TurnWaiter | null = null;
    private transportFailure: Error | null = null;
    private displayModel: string | null = null;
    private displayPermissionMode: PermissionMode | null = null;
    private currentModel: OmpModel | null = null;
    private defaultModel: OmpModel | null = null;
    private availableModels: OmpModel[] = [];

    constructor(session: OmpSession) {
        super(process.env.DEBUG ? session.logPath : undefined);
        this.session = session;
    }

    public async launch(): Promise<RemoteLauncherExitReason> {
        return this.start({
            onExit: () => this.handleExitFromUi(),
            onSwitchToLocal: () => this.handleSwitchFromUi()
        });
    }

    protected createDisplay(context: RemoteLauncherDisplayContext): React.ReactElement {
        return React.createElement(OmpDisplay, context);
    }

    protected async runMainLoop(): Promise<void> {
        const session = this.session;
        const requestedSpawnModel = session.getModel();
        const client = await OmpRpcClient.connect({
            cwd: session.path,
            env: buildOmpEnv(),
            model: typeof requestedSpawnModel === 'string' ? requestedSpawnModel : undefined,
            resumeSessionId: session.sessionId ?? undefined
        });
        this.client = client;
        this.availableModels = client.discovery.models;
        this.currentModel = client.discovery.state.model ?? null;
        this.defaultModel = this.currentModel;

        logger.debug(
            `[omp-remote] RPC ${client.discovery.version} ready; `
            + `session=${client.discovery.state.sessionId} commands=${client.discovery.commands.length} `
            + `models=${client.discovery.models.length}`
        );
        session.onSessionFound(client.discovery.state.sessionId);

        const eventAdapter = new OmpRpcEventAdapter({
            onAgentMessage: (message) => {
                const converted = convertAgentMessage(message);
                if (converted) {
                    session.sendAgentMessage(converted);
                }
            },
            onInkMessage: (message, type) => this.messageBuffer.addMessage(message, type),
            onTurnStarted: () => session.onThinkingChange(true),
            onTurnFinished: () => this.finishCurrentTurn(),
            onPromptResult: (agentInvoked) => {
                if (!agentInvoked) {
                    this.finishCurrentTurn();
                }
            },
            onDiagnostic: (message) => logger.warn(`[omp-remote] ${message}`)
        });
        client.onEvent((event) => eventAdapter.handle(event));
        client.onDiagnostic((message) => logger.warn(`[omp-remote] ${message}`));
        client.onClosed((reason) => {
            if (this.shouldExit) {
                return;
            }
            this.transportFailure = reason;
            this.failCurrentTurn(reason);
            this.queueAbortController.abort(reason);
        });

        session.client.rpcHandlerManager.registerHandler(RPC_METHODS.ListOpencodeModels, async () => ({
            success: true,
            availableModels: this.availableModels.map((model) => ({
                modelId: model.id,
                name: model.name,
                reasoningEfforts: model.thinking?.efforts.map((effort) => ({
                    value: effort,
                    name: effort,
                    isDefault: effort === model.thinking?.defaultLevel
                }))
            })),
            currentModelId: this.currentModel?.id ?? null
        }));

        this.setupAbortHandlers(session.client.rpcHandlerManager, {
            onAbort: () => this.handleAbort(),
            onSwitch: () => this.handleSwitchRequest()
        });

        this.applyDisplayMode(
            session.getPermissionMode() as PermissionMode | undefined,
            this.currentModel?.id
        );
        await this.sendReadyIfIdle();

        while (!this.shouldExit) {
            const batch = await session.queue.waitForMessagesAndGetAsString(
                this.queueAbortController.signal
            );
            if (!batch) {
                if (this.transportFailure) {
                    throw this.transportFailure;
                }
                if (this.shouldExit || session.queue.isClosed()) {
                    break;
                }
                this.queueAbortController = new AbortController();
                continue;
            }

            await this.applyRequestedModel(batch.mode.model);
            this.applyDisplayMode(batch.mode.permissionMode, this.currentModel?.id);
            this.messageBuffer.addMessage(batch.message, 'user');

            const message = batch.mode.permissionMode === 'plan'
                ? `${PLAN_MODE_INSTRUCTION}\n\n${batch.message}`
                : batch.message;
            const turn = createTurnWaiter();
            this.currentTurn = turn;
            session.onThinkingChange(true);

            try {
                const response = await client.request({ type: 'prompt', message });
                if (response?.agentInvoked === false) {
                    turn.resolve();
                }
                await turn.promise;
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                logger.warn('[omp-remote] RPC prompt failed', error);
                session.sendSessionEvent({
                    type: 'message',
                    message: `Oh My Pi RPC prompt failed: ${detail}`
                });
                this.messageBuffer.addMessage(`Oh My Pi RPC prompt failed: ${detail}`, 'status');
            } finally {
                if (this.currentTurn === turn) {
                    this.currentTurn = null;
                }
                session.onThinkingChange(false);
                await this.sendReadyIfIdle();
            }
        }
    }

    protected async cleanup(): Promise<void> {
        this.clearAbortHandlers(this.session.client.rpcHandlerManager);
        this.queueAbortController.abort(new Error('OMP remote launcher cleanup'));
        this.finishCurrentTurn();
        const client = this.client;
        this.client = null;
        if (client) {
            await client.close();
        }
    }

    private async applyRequestedModel(requested: string | null | undefined): Promise<void> {
        if (requested === undefined) {
            return;
        }
        const target = requested === null
            ? this.defaultModel
            : this.availableModels.find((model) => (
                model.id === requested || `${model.provider}/${model.id}` === requested
            )) ?? null;
        if (!target) {
            this.session.sendSessionEvent({
                type: 'message',
                message: `OMP model is not available: ${requested ?? 'default'}`
            });
            return;
        }
        if (target.provider === this.currentModel?.provider && target.id === this.currentModel.id) {
            return;
        }

        const client = this.requireClient();
        this.currentModel = await client.request({
            type: 'set_model',
            provider: target.provider,
            modelId: target.id
        });
        const state = await client.request({ type: 'get_state' });
        this.currentModel = state.model ?? this.currentModel;
    }

    private async sendReadyIfIdle(): Promise<void> {
        if (this.shouldExit || this.currentTurn || this.session.queue.size() > 0) {
            return;
        }
        const client = this.client;
        if (!client || client.state !== 'ready') {
            return;
        }
        try {
            const state = await client.request({ type: 'get_state' });
            if (!state.isStreaming && state.queuedMessageCount === 0 && this.session.queue.size() === 0) {
                this.session.sendSessionEvent({ type: 'ready' });
            }
        } catch (error) {
            logger.debug('[omp-remote] failed checking ready state', error);
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

    private finishCurrentTurn(): void {
        this.currentTurn?.resolve();
    }

    private failCurrentTurn(error: Error): void {
        this.currentTurn?.reject(error);
    }

    private requireClient(): OmpRpcClient {
        if (!this.client) {
            throw new Error('OMP RPC client is not connected');
        }
        return this.client;
    }

    private async handleAbort(): Promise<void> {
        const client = this.client;
        if (client?.state === 'ready') {
            try {
                await client.request({ type: 'abort' });
            } finally {
                this.finishCurrentTurn();
            }
        }
        this.session.sendSessionEvent({ type: 'message', message: 'Session aborted' });
        this.session.onThinkingChange(false);
        this.messageBuffer.addMessage('Turn aborted', 'status');
    }

    private async handleExitFromUi(): Promise<void> {
        await this.requestExit('exit', async () => {
            await this.handleAbort();
            this.queueAbortController.abort(new Error('OMP remote exit'));
        });
    }

    private async handleSwitchFromUi(): Promise<void> {
        await this.requestExit('switch', async () => {
            await this.handleAbort();
            this.queueAbortController.abort(new Error('OMP remote switch'));
        });
    }

    private async handleSwitchRequest(): Promise<void> {
        await this.handleSwitchFromUi();
    }
}

export async function ompRemoteLauncher(
    session: OmpSession
): Promise<'switch' | 'exit'> {
    const launcher = new OmpRemoteLauncher(session);
    return launcher.launch();
}
