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
import type { OmpModel, OmpRpcSpawnConfig } from './rpc/types';
import {
    nativeSessionSnapshotFromState,
    OmpSessionStateReconciler,
    parseOmpSessionMutation,
    runOmpSessionMutation,
    type OmpSessionMutationCommand,
} from './rpc/sessionLifecycle';
import { resolveOmpSessionPath } from './utils/ompSessionScanner';
import type { OmpQueuedInput } from './OmpInputQueue';
import { describeIgnoredOmpAttachments, prepareOmpInput } from './ompInputContent';

type PromptLifecycle = {
    phase: 'awaiting-agent' | 'streaming';
    modeHash: string;
    ignoreAgentEnds: number;
};

class OmpRemoteLauncher extends RemoteLauncherBase {
    private readonly session: OmpSession;
    private client: OmpRpcClient | null = null;
    private currentPrompt: PromptLifecycle | null = null;
    private heldInput: OmpQueuedInput | null = null;
    private nativeFollowUpOutstanding = false;
    private isStreaming = false;
    private dispatching = false;
    private transportFailure: Error | null = null;
    private displayModel: string | null = null;
    private displayPermissionMode: PermissionMode | null = null;
    private currentModel: OmpModel | null = null;
    private defaultModel: OmpModel | null = null;
    private availableModels: OmpModel[] = [];
    private sessionReconciler: OmpSessionStateReconciler | null = null;
    private removeQueueChangeListener: (() => void) | null = null;
    private changeVersion = 0;
    private changeWaiter: (() => void) | null = null;

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
        const spawnBase = {
            cwd: session.path,
            env: buildOmpEnv(),
            model: typeof requestedSpawnModel === 'string' ? requestedSpawnModel : undefined
        };
        const spawnConfig: OmpRpcSpawnConfig = session.sessionId
            ? { ...spawnBase, resumeSessionId: session.sessionId }
            : spawnBase;
        const client = await OmpRpcClient.connect(spawnConfig);
        this.client = client;
        this.availableModels = client.discovery.models;
        this.currentModel = client.discovery.state.model ?? null;
        this.defaultModel = this.currentModel;
        this.isStreaming = client.discovery.state.isStreaming;

        logger.debug(
            `[omp-remote] RPC ${client.discovery.version} ready; `
            + `session=${client.discovery.state.sessionId} commands=${client.discovery.commands.length} `
            + `models=${client.discovery.models.length}`
        );
        session.applyNativeSessionSnapshot(nativeSessionSnapshotFromState(client.discovery.state));
        const sessionReconciler = new OmpSessionStateReconciler(
            client,
            session.applyNativeSessionSnapshot
        );
        this.sessionReconciler = sessionReconciler;

        const eventAdapter = new OmpRpcEventAdapter({
            onAgentMessage: (message) => {
                const converted = convertAgentMessage(message);
                if (converted) {
                    session.sendAgentMessage(converted);
                }
            },
            onInkMessage: (message, type) => this.messageBuffer.addMessage(message, type),
            onUserMessageCommitted: (steering) => {
                if (!steering && this.nativeFollowUpOutstanding) {
                    this.nativeFollowUpOutstanding = false;
                    this.signalChange();
                }
            },
            onTurnStarted: () => {
                this.isStreaming = true;
                if (this.currentPrompt) {
                    this.currentPrompt.phase = 'streaming';
                }
                session.onThinkingChange(true);
                this.signalChange();
            },
            onTurnFinished: () => {
                this.isStreaming = false;
                if (this.currentPrompt?.ignoreAgentEnds) {
                    this.currentPrompt.ignoreAgentEnds -= 1;
                } else {
                    this.clearCurrentPrompt();
                    this.nativeFollowUpOutstanding = false;
                }
                this.signalChange();
                void sessionReconciler.reconcile().catch((error) => {
                    this.handleTransportFailure(error);
                });
                void this.sendReadyIfIdle();
            },
            onPromptResult: (agentInvoked) => {
                if (!agentInvoked) {
                    this.clearCurrentPrompt();
                    this.signalChange();
                    void sessionReconciler.reconcile().catch((error) => {
                        this.handleTransportFailure(error);
                    });
                    void this.sendReadyIfIdle();
                }
            },
            onSessionInfoUpdate: () => {
                void sessionReconciler.reconcile().catch((error) => {
                    this.handleTransportFailure(error);
                });
            },
            onDiagnostic: (message) => logger.warn(`[omp-remote] ${message}`)
        });
        client.onEvent((event) => eventAdapter.handle(event));
        client.onDiagnostic((message) => logger.warn(`[omp-remote] ${message}`));
        client.onClosed((reason) => {
            if (this.shouldExit) {
                return;
            }
            this.handleTransportFailure(reason);
        });
        this.removeQueueChangeListener = session.queue.onChange(() => this.signalChange());

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
            if (this.transportFailure) {
                throw this.transportFailure;
            }

            if (this.heldInput && !session.queue.isHeld(this.heldInput)) {
                this.heldInput = null;
                continue;
            }
            if (!this.heldInput) {
                this.heldInput = session.queue.take();
                if (this.heldInput) {
                    continue;
                }
            }

            if (this.heldInput && this.canDispatch(this.heldInput)) {
                const input = this.heldInput;
                await this.dispatchInput(input, client);
                if (this.heldInput?.id === input.id) {
                    this.heldInput = null;
                }
                continue;
            }

            if (
                session.queue.isClosed()
                && session.queue.size() === 0
                && session.queue.heldSize() === 0
                && !this.hasUnfinishedNativeInput()
            ) {
                break;
            }

            const observedVersion = this.changeVersion;
            await this.waitForChange(observedVersion);
        }
    }

    protected async cleanup(): Promise<void> {
        this.clearAbortHandlers(this.session.client.rpcHandlerManager);
        this.removeQueueChangeListener?.();
        this.removeQueueChangeListener = null;
        this.session.queue.requeueHeld();
        this.heldInput = null;
        this.clearCurrentPrompt();
        this.signalChange();
        await this.sessionReconciler?.drain();
        this.sessionReconciler = null;
        const client = this.client;
        this.client = null;
        if (client) {
            await client.close();
        }
    }

    private canDispatch(input: OmpQueuedInput): boolean {
        const mutation = input.inputMode === 'prompt'
            ? parseOmpSessionMutation(input.text)
            : null;
        if (mutation) {
            return !this.hasUnfinishedNativeInput();
        }

        const nativeBusy = this.currentPrompt !== null || this.isStreaming;
        if (!nativeBusy) {
            return true;
        }
        if (this.currentPrompt && this.currentPrompt.modeHash !== input.modeHash) {
            return false;
        }

        switch (input.inputMode) {
            case 'steer':
                return true;
            case 'abort_and_prompt':
                return !this.nativeFollowUpOutstanding;
            case 'prompt':
            case 'follow_up':
                return !this.nativeFollowUpOutstanding;
            default: {
                const exhaustive: never = input.inputMode;
                return exhaustive;
            }
        }
    }

    private async dispatchInput(
        input: OmpQueuedInput,
        client: OmpRpcClient
    ): Promise<void> {
        if (!this.session.queue.isHeld(input)) {
            return;
        }

        const mutation = input.inputMode === 'prompt'
            ? parseOmpSessionMutation(input.text)
            : null;
        if (mutation) {
            await this.dispatchMutation(input, mutation, client);
            return;
        }

        let prepared: Awaited<ReturnType<typeof prepareOmpInput>>;
        try {
            prepared = await prepareOmpInput(input.text, input.attachments);
        } catch (error) {
            if (!this.session.queue.beginInvocation(input)) {
                return;
            }
            const detail = error instanceof Error ? error.message : String(error);
            this.reportInputFailure(detail);
            this.session.queue.completeInvocation(input);
            await this.sendReadyIfIdle();
            return;
        }
        if (!this.session.queue.isHeld(input)) {
            return;
        }

        const ignored = describeIgnoredOmpAttachments(prepared.ignoredAttachments);
        if (ignored) {
            this.session.sendSessionEvent({ type: 'message', message: ignored });
            this.messageBuffer.addMessage(ignored, 'status');
        }
        if (!prepared.message.trim() && !prepared.images?.length) {
            if (!this.session.queue.beginInvocation(input)) {
                return;
            }
            this.reportInputFailure('OMP RPC received no text or supported image attachment');
            this.session.queue.completeInvocation(input);
            await this.sendReadyIfIdle();
            return;
        }
        if (!this.session.queue.beginInvocation(input)) {
            return;
        }

        this.dispatching = true;
        const wasBusy = this.currentPrompt !== null || this.isStreaming;
        let startedPrompt = false;
        let queuedFollowUp = false;
        try {
            if (!wasBusy) {
                await this.applyRequestedModel(input.mode.model);
            }
            this.applyDisplayMode(input.mode.permissionMode, this.currentModel?.id);
            this.messageBuffer.addMessage(input.text, 'user');
            const message = input.mode.permissionMode === 'plan'
                ? `${PLAN_MODE_INSTRUCTION}\n\n${prepared.message}`
                : prepared.message;

            switch (input.inputMode) {
                case 'prompt': {
                    if (wasBusy) {
                        queuedFollowUp = true;
                        this.nativeFollowUpOutstanding = true;
                        const response = await client.request({
                            type: 'prompt',
                            message,
                            images: prepared.images,
                            streamingBehavior: 'followUp'
                        });
                        if (response?.agentInvoked === false) {
                            this.nativeFollowUpOutstanding = false;
                        }
                    } else {
                        startedPrompt = true;
                        this.beginPrompt(input.modeHash, 0);
                        const response = await client.request({
                            type: 'prompt',
                            message,
                            images: prepared.images
                        });
                        if (response?.agentInvoked === false) {
                            this.clearCurrentPrompt();
                        }
                    }
                    break;
                }
                case 'steer':
                    if (!wasBusy) {
                        startedPrompt = true;
                        this.beginPrompt(input.modeHash, 0);
                    }
                    await client.request({ type: 'steer', message, images: prepared.images });
                    break;
                case 'follow_up':
                    if (wasBusy) {
                        queuedFollowUp = true;
                        this.nativeFollowUpOutstanding = true;
                    } else {
                        startedPrompt = true;
                        this.beginPrompt(input.modeHash, 0);
                    }
                    await client.request({ type: 'follow_up', message, images: prepared.images });
                    break;
                case 'abort_and_prompt':
                    startedPrompt = true;
                    this.nativeFollowUpOutstanding = false;
                    this.beginPrompt(input.modeHash, wasBusy ? 1 : 0);
                    await client.request({ type: 'abort_and_prompt', message, images: prepared.images });
                    break;
                default: {
                    const exhaustive: never = input.inputMode;
                    return exhaustive;
                }
            }
            this.session.queue.completeInvocation(input);
        } catch (error) {
            if (startedPrompt) {
                this.clearCurrentPrompt();
            }
            if (queuedFollowUp) {
                this.nativeFollowUpOutstanding = false;
            }
            const detail = error instanceof Error ? error.message : String(error);
            logger.warn(`[omp-remote] RPC ${input.inputMode} failed`, error);
            this.reportInputFailure(detail);
            this.session.queue.completeInvocation(input);
        } finally {
            this.dispatching = false;
            this.signalChange();
            await this.sendReadyIfIdle();
        }
    }

    private async dispatchMutation(
        input: OmpQueuedInput,
        mutation: ReturnType<typeof parseOmpSessionMutation> & {},
        client: OmpRpcClient
    ): Promise<void> {
        if (!this.session.queue.beginInvocation(input)) {
            return;
        }
        this.dispatching = true;
        this.session.onThinkingChange(true);
        this.messageBuffer.addMessage(input.text, 'user');
        if (input.attachments.length > 0) {
            const warning = 'OMP session commands ignore attachments';
            this.session.sendSessionEvent({ type: 'message', message: warning });
            this.messageBuffer.addMessage(warning, 'status');
        }
        try {
            await this.applyRequestedModel(input.mode.model);
            this.applyDisplayMode(input.mode.permissionMode, this.currentModel?.id);
            if (mutation.type === 'invalid_session_command') {
                throw new Error(mutation.message);
            }
            if (mutation.type === 'resume_session_picker') {
                throw new Error('Use /resume <session id> when controlling OMP remotely');
            }
            let rpcMutation: OmpSessionMutationCommand;
            if (mutation.type === 'resume_session') {
                const sessionPath = await resolveOmpSessionPath(mutation.sessionArg, this.session.path);
                if (sessionPath === null) {
                    throw new Error(`Session "${mutation.sessionArg}" not found`);
                }
                rpcMutation = { type: 'switch_session', sessionPath };
            } else {
                rpcMutation = mutation;
            }
            await runOmpSessionMutation(client, rpcMutation, this.session.applyNativeSessionSnapshot);
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            logger.warn('[omp-remote] RPC session mutation failed', error);
            this.session.sendSessionEvent({
                type: 'message',
                message: `Oh My Pi RPC session mutation failed: ${detail}`
            });
            this.messageBuffer.addMessage(`Oh My Pi RPC session mutation failed: ${detail}`, 'status');
        } finally {
            this.session.queue.completeInvocation(input);
            this.dispatching = false;
            this.session.onThinkingChange(false);
            this.signalChange();
            await this.sendReadyIfIdle();
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
        if (this.shouldExit || this.hasLocalPendingInput()) {
            return;
        }
        const client = this.client;
        if (!client || client.state !== 'ready') {
            return;
        }
        try {
            const state = await client.request({ type: 'get_state' });
            this.isStreaming = state.isStreaming;
            if (
                !state.isStreaming
                && state.queuedMessageCount === 0
                && !this.hasLocalPendingInput()
            ) {
                this.session.sendSessionEvent({ type: 'ready' });
            }
        } catch (error) {
            logger.debug('[omp-remote] failed checking ready state', error);
        }
    }

    private hasLocalPendingInput(): boolean {
        return (
            this.dispatching
            || this.currentPrompt !== null
            || this.nativeFollowUpOutstanding
            || this.session.queue.size() > 0
            || this.session.queue.heldSize() > 0
        );
    }

    private hasUnfinishedNativeInput(): boolean {
        return (
            this.dispatching
            || this.currentPrompt !== null
            || this.nativeFollowUpOutstanding
            || this.isStreaming
        );
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

    private beginPrompt(modeHash: string, ignoreAgentEnds: number): void {
        this.currentPrompt = {
            phase: 'awaiting-agent',
            modeHash,
            ignoreAgentEnds
        };
        this.session.onThinkingChange(true);
        this.signalChange();
    }

    private clearCurrentPrompt(): void {
        if (!this.currentPrompt) {
            this.session.onThinkingChange(false);
            return;
        }
        this.currentPrompt = null;
        this.session.onThinkingChange(false);
        this.signalChange();
    }

    private reportInputFailure(detail: string): void {
        const message = `Oh My Pi RPC input failed: ${detail}`;
        this.session.sendSessionEvent({ type: 'message', message });
        this.messageBuffer.addMessage(message, 'status');
    }

    private handleTransportFailure(error: unknown): void {
        const failure = error instanceof Error ? error : new Error(String(error));
        this.transportFailure = failure;
        this.clearCurrentPrompt();
        this.signalChange();
    }

    private signalChange(): void {
        this.changeVersion += 1;
        const waiter = this.changeWaiter;
        this.changeWaiter = null;
        waiter?.();
    }

    private waitForChange(observedVersion: number): Promise<void> {
        if (this.changeVersion !== observedVersion) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.changeWaiter = resolve;
            if (this.changeVersion !== observedVersion) {
                this.changeWaiter = null;
                resolve();
            }
        });
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
            await client.request({ type: 'abort' });
        }
        this.nativeFollowUpOutstanding = false;
        this.isStreaming = false;
        this.clearCurrentPrompt();
        this.signalChange();
        this.session.sendSessionEvent({ type: 'message', message: 'Session aborted' });
        this.session.onThinkingChange(false);
        this.messageBuffer.addMessage('Turn aborted', 'status');
    }

    private async handleExitFromUi(): Promise<void> {
        await this.requestExit('exit', async () => {
            await this.handleAbort();
            this.signalChange();
        });
    }

    private async handleSwitchFromUi(): Promise<void> {
        await this.requestExit('switch', async () => {
            this.session.queue.requeueHeld();
            this.heldInput = null;
            this.clearCurrentPrompt();
            this.signalChange();
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
