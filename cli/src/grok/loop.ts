import { MessageQueue2 } from '@/utils/MessageQueue2';
import { logger } from '@/ui/logger';
import { runLocalRemoteSession } from '@/agent/loopBase';
import { GrokSession } from './session';
import { grokLocalLauncher } from './grokLocalLauncher';
import { grokRemoteLauncher } from './grokRemoteLauncher';
import { ApiClient, ApiSessionClient } from '@/lib';
import type { GrokMode, PermissionMode } from './types';

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
    onSessionReady?: (session: GrokSession) => void;
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
        onModeChange: opts.onModeChange,
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
        const sessionModel = session.getModel();
        return sessionModel != null ? sessionModel : opts.model;
    };

    await runLocalRemoteSession({
        session,
        startingMode: opts.startingMode,
        logTag: 'grok-loop',
        runLocal: (instance) => grokLocalLauncher(instance, {
            model: getCurrentModel()
        }),
        runRemote: (instance) => grokRemoteLauncher(instance, {
            model: getCurrentModel()
        }),
        onSessionReady: opts.onSessionReady
    });
}
