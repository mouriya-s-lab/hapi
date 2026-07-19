import { ApiClient, ApiSessionClient } from '@/lib';
import { AgentSessionBase } from '@/agent/sessionBase';
import type { OmpMode, PermissionMode } from './types';
import type { LocalLaunchExitReason } from '@/agent/localLaunchPolicy';
import type { OmpNativeSession } from '@hapi/protocol/types';
import type { OmpConfiguredThinkingLevel, OmpThinkingState } from '@hapi/protocol/omp';
import type { OmpInputQueue } from './OmpInputQueue';

type LocalLaunchFailure = {
    message: string;
    exitReason: LocalLaunchExitReason;
};

export type OmpRuntimeConfigRequest = {
    model?: string | null;
    effort?: OmpConfiguredThinkingLevel;
};

export type OmpRuntimeConfigApplied = {
    model?: string;
    effort?: OmpConfiguredThinkingLevel;
};

type OmpRuntimeConfigApplier = (
    config: OmpRuntimeConfigRequest
) => Promise<OmpRuntimeConfigApplied>;

export class OmpSession extends AgentSessionBase<OmpMode, OmpInputQueue> {
    readonly startedBy: 'runner' | 'terminal';
    readonly startingMode: 'local' | 'remote';
    localLaunchFailure: LocalLaunchFailure | null = null;
    private nativeSession: OmpNativeSession | null;
    private runtimeConfigApplier: OmpRuntimeConfigApplier | null = null;

    constructor(opts: {
        api: ApiClient;
        client: ApiSessionClient;
        path: string;
        logPath: string;
        sessionId: string | null;
        messageQueue: OmpInputQueue;
        onModeChange: (mode: 'local' | 'remote') => void;
        mode?: 'local' | 'remote';
        startedBy: 'runner' | 'terminal';
        startingMode: 'local' | 'remote';
        permissionMode?: PermissionMode;
        model?: string | null;
        effort?: OmpConfiguredThinkingLevel;
        nativeSession?: OmpNativeSession;
    }) {
        super({
            api: opts.api,
            client: opts.client,
            path: opts.path,
            logPath: opts.logPath,
            sessionId: opts.sessionId,
            messageQueue: opts.messageQueue,
            onModeChange: opts.onModeChange,
            mode: opts.mode,
            sessionLabel: 'OmpSession',
            sessionIdLabel: 'Omp',
            applySessionIdToMetadata: (metadata, sessionId, extras) => {
                const nativeSession = extras?.ompSession;
                if (!nativeSession || nativeSession.id !== sessionId) {
                    throw new Error('OMP native session snapshot must accompany its session ID');
                }
                const next = {
                    ...metadata,
                    ompSession: nativeSession
                };
                if (nativeSession.name) {
                    next.name = nativeSession.name;
                } else {
                    delete next.name;
                }
                return next;
            },
            permissionMode: opts.permissionMode,
            model: opts.model,
            effort: opts.effort
        });

        this.startedBy = opts.startedBy;
        this.startingMode = opts.startingMode;
        this.permissionMode = opts.permissionMode;
        this.nativeSession = opts.nativeSession ?? null;
    }

    setPermissionMode = (mode: PermissionMode): void => {
        this.permissionMode = mode;
    };

    setModel = (model: string | null): void => {
        this.model = model;
    };

    setEffort = (effort: OmpConfiguredThinkingLevel): void => {
        this.effort = effort;
    };

    setRuntimeConfigApplier = (applier: OmpRuntimeConfigApplier | null): void => {
        this.runtimeConfigApplier = applier;
    };

    applyRuntimeConfig = async (
        config: OmpRuntimeConfigRequest
    ): Promise<OmpRuntimeConfigApplied> => {
        if (!this.runtimeConfigApplier) {
            throw new Error('OMP native runtime is not ready for configuration changes');
        }
        return await this.runtimeConfigApplier(config);
    };

    updateThinkingState = (state: OmpThinkingState): void => {
        this.client.updateMetadata((metadata) => ({
            ...metadata,
            ompThinking: state
        }));
    };

    updateDiscoveredCapabilities = (capabilities: {
        tools?: string[];
        slashCommands?: string[];
    }): void => {
        this.client.updateMetadata((metadata) => ({
            ...metadata,
            ...(capabilities.tools ? { tools: capabilities.tools } : {}),
            ...(capabilities.slashCommands ? { slashCommands: capabilities.slashCommands } : {})
        }));
    };

    applyNativeSessionSnapshot = (snapshot: OmpNativeSession): void => {
        this.nativeSession = snapshot;
        this.onSessionFound(snapshot.id, { ompSession: snapshot });
    };

    getNativeSession = (): OmpNativeSession | null => this.nativeSession;

    recordLocalLaunchFailure = (message: string, exitReason: LocalLaunchExitReason): void => {
        this.localLaunchFailure = { message, exitReason };
    };

    sendAgentMessage = (message: unknown): void => {
        this.client.sendAgentMessage(message);
    };

    sendUserMessage = (text: string): void => {
        this.client.sendUserMessage(text);
    };

    sendSessionEvent = (event: Parameters<ApiSessionClient['sendSessionEvent']>[0]): void => {
        this.client.sendSessionEvent(event);
    };
}
