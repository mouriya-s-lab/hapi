import { MessageQueue2 } from '@/utils/MessageQueue2';
import { logger } from '@/ui/logger';
import { runLocalRemoteSession } from '@/agent/loopBase';
import { GrokSession } from './session';
import { grokLocalLauncher } from './grokLocalLauncher';
import { grokRemoteLauncher } from './grokRemoteLauncher';
import { ApiClient, ApiSessionClient } from '@/lib';
import type { GrokMode, PermissionMode } from './types';
import { resolveGrokHandoffModel } from './runtimeConfigState';
import type { GrokSessionController } from './sessionController';

interface GrokLoopOptions {
    path: string;
    startingMode?: 'local' | 'remote';
    startedBy?: 'runner' | 'terminal';
    onModeChange: (mode: 'local' | 'remote') => void;
    messageQueue: MessageQueue2<GrokMode>;
    session: ApiSessionClient;
    api: ApiClient;
    permissionMode?: PermissionMode;
    model?: string;
    modelReasoningEffort?: string | null;
    resumeSessionId?: string;
    controller: GrokSessionController;
    onSessionReady?: (session: GrokSession) => void;
    onModelRollback?: (model: string | null) => void;
    onReasoningEffortRollback?: (effort: string | null) => void;
}

export async function grokLoop(opts: GrokLoopOptions): Promise<void> {
    const logPath = logger.getLogPath();
    const startedBy = opts.startedBy ?? 'terminal';
    const startingMode = opts.startingMode ?? 'local';

    const session = new GrokSession({
        api: opts.api,
        client: opts.session,
        path: opts.path,
        sessionId: opts.resumeSessionId ?? null,
        logPath,
        messageQueue: opts.messageQueue,
        onModeChange: (mode) => {
            opts.controller.setControl({ kind: mode });
            opts.onModeChange(mode);
        },
        mode: startingMode,
        startedBy,
        startingMode,
        permissionMode: opts.permissionMode ?? 'default',
        modelReasoningEffort: opts.modelReasoningEffort
    });

    if (opts.resumeSessionId) {
        session.onSessionFound(opts.resumeSessionId);
    }

    const getCurrentModel = (): string | undefined => {
        return resolveGrokHandoffModel(session.getModel(), opts.model);
    };

    await runLocalRemoteSession({
        session,
        startingMode: opts.startingMode,
        logTag: 'grok-loop',
        runLocal: (instance) => grokLocalLauncher(instance, {
            model: getCurrentModel(),
            controller: opts.controller
        }),
        runRemote: (instance) => grokRemoteLauncher(instance, {
            model: getCurrentModel(),
            controller: opts.controller,
            onModelRollback: opts.onModelRollback,
            onReasoningEffortRollback: opts.onReasoningEffortRollback
        }),
        onSessionReady: opts.onSessionReady
    });
}
