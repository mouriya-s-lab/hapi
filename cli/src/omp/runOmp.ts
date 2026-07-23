import { logger } from '@/ui/logger';
import { ompLoop } from './loop';
import { hashObject } from '@/utils/deterministicJson';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import type { AgentState } from '@/api/types';
import type { OmpSession } from './session';
import type { OmpMode, PermissionMode } from './types';
import { bootstrapExistingSession, bootstrapSession } from '@/agent/sessionFactory';
import { registerLocalHandoffHandler } from '@/agent/localHandoff';
import { createModeChangeHandler, createRunnerLifecycle, setControlledByUser } from '@/agent/runnerLifecycle';
import { isPermissionModeAllowedForFlavor } from '@hapi/protocol';
import { PermissionModeSchema } from '@hapi/protocol/schemas';
import { getInvokedCwd } from '@/utils/invokedCwd';
import { resolveOmpRuntimeConfig } from './utils/config';
import { OmpInputQueue } from './OmpInputQueue';
import {
    OMP_THINKING_LEVELS,
    type OmpConfiguredThinkingLevel
} from '@hapi/protocol/omp';

function parseConfiguredThinking(value: string): OmpConfiguredThinkingLevel {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'auto') {
        return 'auto';
    }
    if ((OMP_THINKING_LEVELS as readonly string[]).includes(normalized)) {
        return normalized as OmpConfiguredThinkingLevel;
    }
    throw new Error(`Invalid OMP thinking level: ${value}`);
}

function resolveConfiguredThinking(
    value: string | undefined
): OmpConfiguredThinkingLevel | undefined {
    return value === undefined ? undefined : parseConfiguredThinking(value);
}

export async function runOmp(opts: {
    startedBy?: 'runner' | 'terminal';
    startingMode?: 'local' | 'remote';
    permissionMode?: PermissionMode;
    model?: string;
    effort?: string;
    resumeSessionId?: string;
    existingSessionId?: string;
    workingDirectory?: string;
} = {}): Promise<void> {
    const workingDirectory = opts.workingDirectory ?? getInvokedCwd();
    const startedBy = opts.startedBy ?? 'terminal';

    logger.debug(`[omp] Starting with options: startedBy=${startedBy}, startingMode=${opts.startingMode}`);

    if (startedBy === 'runner' && opts.startingMode === 'local') {
        logger.debug('[omp] Runner spawn requested with local mode; forcing remote mode');
        opts.startingMode = 'remote';
    }

    const initialState: AgentState = {
        controlledByUser: false
    };

    const machineDefault = resolveOmpRuntimeConfig().model;
    const runtimeConfig = resolveOmpRuntimeConfig({ model: opts.model });
    const persistedModel = runtimeConfig.modelSource === 'default'
        ? undefined
        : runtimeConfig.model;
    let configuredThinking = resolveConfiguredThinking(opts.effort);

    const bootstrap = opts.existingSessionId
        ? await bootstrapExistingSession({
            sessionId: opts.existingSessionId,
            flavor: 'omp',
            startedBy,
            workingDirectory
        })
        : await bootstrapSession({
            flavor: 'omp',
            startedBy,
            workingDirectory,
            agentState: initialState,
            model: persistedModel,
            effort: configuredThinking
        });
    const { api, session } = bootstrap;

    const startingMode: 'local' | 'remote' = opts.startingMode
        ?? (startedBy === 'runner' ? 'remote' : 'local');

    setControlledByUser(session, startingMode);

    const messageQueue = new OmpInputQueue((mode) => hashObject({
        permissionMode: mode.permissionMode,
        model: mode.model,
        effort: mode.effort
    }));

    const sessionWrapperRef: { current: OmpSession | null } = { current: null };
    let currentPermissionMode: PermissionMode = opts.permissionMode ?? 'default';
    let sessionModel: string | null = persistedModel ?? null;
    let resolvedModel = sessionModel ?? machineDefault;

    const lifecycle = createRunnerLifecycle({
        session,
        logTag: 'omp',
        stopKeepAlive: () => sessionWrapperRef.current?.stopKeepAlive()
    });

    lifecycle.registerProcessHandlers();
    registerKillSessionHandler(session.rpcHandlerManager, lifecycle);
    registerLocalHandoffHandler(session.rpcHandlerManager, lifecycle);

    const syncSessionMode = () => {
        const sessionInstance = sessionWrapperRef.current;
        if (!sessionInstance) {
            return;
        }
        sessionInstance.setPermissionMode(currentPermissionMode);
        sessionInstance.setModel(sessionModel);
        if (configuredThinking) {
            sessionInstance.setEffort(configuredThinking);
        }
        sessionInstance.pushKeepAlive();

        logger.debug(
            `[omp] Synced session config for keepalive: permissionMode=${currentPermissionMode}, `
            + `model=${resolvedModel ?? 'default'}, effort=${configuredThinking ?? 'native-default'}`
        );
    };

    session.onUserMessage((message, localId) => {
        const mode: OmpMode = {
            permissionMode: currentPermissionMode,
            model: resolvedModel,
            effort: configuredThinking
        };
        messageQueue.push({
            text: message.content.text,
            attachments: message.content.attachments,
            inputMode: message.meta?.ompInputMode ?? 'prompt',
            mode,
            localId
        });
    });

    session.onCancelQueuedMessage((localId) => {
        const removed = messageQueue.cancelByLocalId(localId);
        logger.debug(`[omp] cancelByLocalId(${localId}): ${removed ? 'removed' : 'not found (best-effort)'}`);
        return removed;
    });

    const resolvePermissionMode = (value: unknown): PermissionMode => {
        const parsed = PermissionModeSchema.safeParse(value);
        if (!parsed.success || !isPermissionModeAllowedForFlavor(parsed.data, 'omp')) {
            throw new Error('Invalid permission mode');
        }
        return parsed.data as PermissionMode;
    };

    const resolveModel = (value: unknown): string | null => {
        if (value === null) {
            return null;
        }
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
        if (
            value
            && typeof value === 'object'
            && 'provider' in value
            && 'modelId' in value
            && typeof value.provider === 'string'
            && value.provider.trim().length > 0
            && typeof value.modelId === 'string'
            && value.modelId.trim().length > 0
        ) {
            return `${value.provider.trim()}/${value.modelId.trim()}`;
        }
        throw new Error('Invalid model');
    };

    const resolveEffort = (value: unknown): OmpConfiguredThinkingLevel => {
        if (value === null) {
            return 'auto';
        }
        if (typeof value !== 'string') {
            throw new Error('Invalid effort');
        }
        return parseConfiguredThinking(value);
    };

    session.rpcHandlerManager.registerHandler('set-session-config', async (payload: unknown) => {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid session config payload');
        }
        const config = payload as { permissionMode?: unknown; model?: unknown; effort?: unknown };
        const applied: Record<string, unknown> = {};

        if (config.permissionMode !== undefined) {
            currentPermissionMode = resolvePermissionMode(config.permissionMode);
            applied.permissionMode = currentPermissionMode;
        }

        const requestedModel = config.model === undefined
            ? undefined
            : resolveModel(config.model);
        const requestedEffort = config.effort === undefined
            ? undefined
            : resolveEffort(config.effort);

        if (requestedModel !== undefined || requestedEffort !== undefined) {
            const sessionInstance = sessionWrapperRef.current;
            if (!sessionInstance) {
                throw new Error('OMP native runtime is not ready for configuration changes');
            }
            const confirmed = await sessionInstance.applyRuntimeConfig({
                ...(requestedModel !== undefined ? { model: requestedModel } : {}),
                ...(requestedEffort !== undefined ? { effort: requestedEffort } : {})
            });
            if (requestedModel !== undefined) {
                if (!confirmed.model) {
                    throw new Error('OMP did not confirm the requested model');
                }
                sessionModel = confirmed.model;
                resolvedModel = confirmed.model;
                applied.model = confirmed.model;
            }
            if (requestedEffort !== undefined) {
                if (!confirmed.effort) {
                    throw new Error('OMP did not confirm the requested effort');
                }
                configuredThinking = confirmed.effort;
                applied.effort = confirmed.effort;
            }
        }

        syncSessionMode();
        return { applied };
    });

    let crashed = false;

    try {
        await ompLoop({
            path: workingDirectory,
            startingMode,
            startedBy,
            messageQueue,
            session,
            api,
            permissionMode: currentPermissionMode,
            model: machineDefault,
            effort: configuredThinking,
            resumeSessionId: opts.resumeSessionId,
            nativeSession: bootstrap.metadata.ompSession?.id === opts.resumeSessionId
                ? bootstrap.metadata.ompSession
                : undefined,
            onModeChange: createModeChangeHandler(session),
            onSessionReady: (instance) => {
                sessionWrapperRef.current = instance;
                syncSessionMode();
            }
        });
    } catch (error) {
        crashed = true;
        lifecycle.markCrash(error);
        const detail = error instanceof Error ? error.message : String(error);
        session.sendSessionEvent({ type: 'message', message: `OMP session failed: ${detail}` });
        logger.debug('[omp] Loop error:', error);
    } finally {
        const localFailure = sessionWrapperRef.current?.localLaunchFailure;
        if (localFailure?.exitReason === 'exit') {
            lifecycle.setExitCode(1);
            lifecycle.setArchiveReason(`Local launch failed: ${localFailure.message.slice(0, 200)}`);
            lifecycle.setSessionEndReason('error');
        } else if (!crashed) {
            lifecycle.setSessionEndReason('completed');
        }
        await lifecycle.cleanupAndExit();
    }
}
