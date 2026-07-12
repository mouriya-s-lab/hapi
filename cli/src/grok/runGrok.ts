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

    logger.debug(`[grok] Starting with options: startedBy=${startedBy}, startingMode=${opts.startingMode}`);

    if (startedBy === 'runner' && opts.startingMode === 'local') {
        logger.debug('[grok] Runner spawn requested with local mode; forcing remote mode');
        opts.startingMode = 'remote';
    }

    const initialState: AgentState = {
        controlledByUser: false
    };

    const runtimeConfig = resolveGrokRuntimeConfig({ model: opts.model });
    const persistedModel = runtimeConfig.model;

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
            model: persistedModel,
            modelReasoningEffort: opts.modelReasoningEffort ?? undefined
        });
    const { api, session } = bootstrap;

    const startingMode: 'local' | 'remote' = opts.startingMode
        ?? (startedBy === 'runner' ? 'remote' : 'local');

    setControlledByUser(session, startingMode);

    const messageQueue = new MessageQueue2<GrokMode>((mode) => hashObject({
        permissionMode: mode.permissionMode,
        model: mode.model,
        modelReasoningEffort: mode.modelReasoningEffort
    }));

    const sessionWrapperRef: { current: GrokSession | null } = { current: null };
    let currentPermissionMode: PermissionMode = opts.permissionMode ?? 'default';
    let sessionModel: string | null = persistedModel ?? null;
    let resolvedModel = sessionModel ?? persistedModel;
    let sessionModelReasoningEffort = opts.modelReasoningEffort ?? null;

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
        sessionInstance.setModel(sessionModel);
        sessionInstance.setModelReasoningEffort(sessionModelReasoningEffort);
        sessionInstance.pushKeepAlive();

        logger.debug(`[grok] Synced session config for keepalive: permissionMode=${currentPermissionMode}, model=${resolvedModel}`);
    };

    session.onUserMessage((message, localId) => {
        const formattedText = formatMessageWithAttachments(message.content.text, message.content.attachments);
        const mode: GrokMode = {
            permissionMode: currentPermissionMode,
            model: resolvedModel,
            modelReasoningEffort: sessionModelReasoningEffort
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
        const applied: Record<string, unknown> = {};

        if (config.permissionMode !== undefined) {
            currentPermissionMode = resolvePermissionMode(config.permissionMode);
            applied.permissionMode = currentPermissionMode;
        }

        if (config.model !== undefined) {
            sessionModel = resolveModel(config.model);
            resolvedModel = sessionModel ?? persistedModel;
            applied.model = sessionModel;
        }
        if (config.modelReasoningEffort !== undefined) {
            if (config.modelReasoningEffort !== null && typeof config.modelReasoningEffort !== 'string') throw new Error('Invalid reasoning effort');
            sessionModelReasoningEffort = config.modelReasoningEffort as string | null;
            applied.modelReasoningEffort = sessionModelReasoningEffort;
        }

        syncSessionMode();
        return { applied };
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
            model: persistedModel,
            modelReasoningEffort: sessionModelReasoningEffort,
            resumeSessionId: opts.resumeSessionId,
            onModeChange: createModeChangeHandler(session),
            onModelRollback: (model) => {
                sessionModel = model;
                resolvedModel = model ?? persistedModel;
                syncSessionMode();
            },
            onReasoningEffortRollback: (effort) => {
                sessionModelReasoningEffort = effort;
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
