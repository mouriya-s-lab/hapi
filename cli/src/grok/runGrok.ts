import { logger } from '@/ui/logger';
import { grokLoop } from './loop';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { hashObject } from '@/utils/deterministicJson';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import type { AgentState } from '@/api/types';
import type { GrokSession } from './session';
import type { GrokMode, PermissionMode } from './types';
import { bootstrapExistingSession, bootstrapSession } from '@/agent/sessionFactory';
import { registerLocalHandoffHandler } from '@/agent/localHandoff';
import { createModeChangeHandler, createRunnerLifecycle, setControlledByUser } from '@/agent/runnerLifecycle';
import { isPermissionModeAllowedForFlavor } from '@hapi/protocol';
import { PermissionModeSchema } from '@hapi/protocol/schemas';
import { formatMessageWithAttachments } from '@/utils/attachmentFormatter';
import { getInvokedCwd } from '@/utils/invokedCwd';
import { resolveGrokRuntimeConfig } from './utils/config';
import { resolveGrokReasoningEffort } from './runtimeConfigState';
import { verifyGrokVersion } from './version';
import { GrokSessionController } from './sessionController';

export async function runGrok(opts: {
    startedBy?: 'runner' | 'terminal';
    startingMode?: 'local' | 'remote';
    permissionMode?: PermissionMode;
    model?: string;
    modelReasoningEffort?: string | null;
    resumeSessionId?: string;
    existingSessionId?: string;
    workingDirectory?: string;
} = {}): Promise<void> {
    const workingDirectory = opts.workingDirectory ?? getInvokedCwd();
    const startedBy = opts.startedBy ?? 'terminal';
    await verifyGrokVersion();

    logger.debug(`[grok] Starting with options: startedBy=${startedBy}, startingMode=${opts.startingMode}`);

    if (startedBy === 'runner' && opts.startingMode === 'local') {
        logger.debug('[grok] Runner spawn requested with local mode; forcing remote mode');
        opts.startingMode = 'remote';
    }

    const initialState: AgentState = {
        controlledByUser: false
    };

    const startingMode: 'local' | 'remote' = opts.startingMode
        ?? (startedBy === 'runner' ? 'remote' : 'local');
    const launch = opts.resumeSessionId !== undefined
        ? { kind: 'resume' as const, sessionId: opts.resumeSessionId }
        : (() => {
            const creationModel = resolveGrokRuntimeConfig({ model: opts.model }).model;
            return {
                kind: 'fresh' as const,
                model: creationModel,
                effort: resolveGrokReasoningEffort(creationModel, opts.modelReasoningEffort)
            };
        })();
    const creationModel = launch.kind === 'fresh' ? launch.model : undefined;
    const initialReasoningEffort = launch.kind === 'fresh' ? launch.effort : null;
    const initialPermissionMode: PermissionMode = startingMode === 'local'
        ? 'default'
        : opts.permissionMode ?? 'default';

    const bootstrap = opts.existingSessionId
        ? await bootstrapExistingSession({
            sessionId: opts.existingSessionId,
            flavor: 'grok',
            startedBy,
            workingDirectory
        })
        : await bootstrapSession({
            flavor: 'grok',
            startedBy,
            workingDirectory,
            agentState: initialState,
            model: creationModel,
            modelReasoningEffort: initialReasoningEffort ?? undefined
        });
    const { api, session } = bootstrap;

    setControlledByUser(session, startingMode);

    const messageQueue = new MessageQueue2<GrokMode>((mode) => hashObject({
        permissionMode: mode.permissionMode,
        model: mode.model,
        modelReasoningEffort: mode.modelReasoningEffort
    }));

    const sessionWrapperRef: { current: GrokSession | null } = { current: null };
    let currentPermissionMode: PermissionMode = initialPermissionMode;
    let requestedModel: string | null = creationModel ?? null;
    let requestedReasoningEffort = initialReasoningEffort;
    const controller = new GrokSessionController({
        sessionId: opts.resumeSessionId,
        control: { kind: startingMode },
        effort: initialReasoningEffort,
        permissionMode: currentPermissionMode
    });

    const lifecycle = createRunnerLifecycle({
        session,
        logTag: 'grok',
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
        sessionInstance.setModel(requestedModel);
        sessionInstance.setModelReasoningEffort(requestedReasoningEffort);
        sessionInstance.pushKeepAlive();

        logger.debug(`[grok] Synced requested session config: permissionMode=${currentPermissionMode}, model=${requestedModel}`);
    };

    session.onUserMessage((message, localId) => {
        const formattedText = formatMessageWithAttachments(message.content.text, message.content.attachments);
        const mode: GrokMode = {
            permissionMode: currentPermissionMode,
            model: requestedModel,
            modelReasoningEffort: requestedReasoningEffort
        };
        messageQueue.push(formattedText, mode, localId);
    });

    session.onCancelQueuedMessage((localId) => {
        const removed = messageQueue.cancelByLocalId(localId);
        logger.debug(`[grok] cancelByLocalId(${localId}): ${removed ? 'removed' : 'not found (best-effort)'}`);
        return removed;
    });

    const resolvePermissionMode = (value: unknown): PermissionMode => {
        const parsed = PermissionModeSchema.safeParse(value);
        if (!parsed.success || !isPermissionModeAllowedForFlavor(parsed.data, 'grok')) {
            throw new Error('Invalid permission mode');
        }
        return parsed.data as PermissionMode;
    };

    const resolveModel = (value: unknown): string | null => {
        if (value === null) {
            return null;
        }
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error('Invalid model');
        }
        return value.trim();
    };

    session.rpcHandlerManager.registerHandler('set-session-config', async (payload: unknown) => {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid session config payload');
        }
        const config = payload as { permissionMode?: unknown; model?: unknown; modelReasoningEffort?: unknown };
        const permissionMode = config.permissionMode === undefined ? undefined : resolvePermissionMode(config.permissionMode);
        const model = config.model === undefined ? undefined : resolveModel(config.model);
        const result = await controller.applyConfig({
            permissionMode,
            model,
            modelReasoningEffort: config.modelReasoningEffort
        });
        if (permissionMode !== undefined) currentPermissionMode = permissionMode;
        if (model !== undefined) requestedModel = model;
        if (result.applied.modelReasoningEffort === null) requestedReasoningEffort = null;
        syncSessionMode();
        return result;
    });

    let crashed = false;

    try {
        await grokLoop({
            path: workingDirectory,
            startingMode,
            startedBy,
            messageQueue,
            session,
            api,
            permissionMode: currentPermissionMode,
            model: creationModel,
            modelReasoningEffort: requestedReasoningEffort,
            resumeSessionId: opts.resumeSessionId,
            controller,
            onModeChange: createModeChangeHandler(session),
            onModelRollback: (model) => {
                requestedModel = model;
                syncSessionMode();
            },
            onReasoningEffortRollback: (effort) => {
                requestedReasoningEffort = effort;
                syncSessionMode();
            },
            onSessionReady: (instance) => {
                sessionWrapperRef.current = instance;
                syncSessionMode();
            }
        });
    } catch (error) {
        crashed = true;
        lifecycle.markCrash(error);
        logger.debug('[grok] Loop error:', error);
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
