import { MessageQueue2 } from '@/utils/MessageQueue2';
import { logger } from '@/ui/logger';
import { runLocalRemoteSession } from '@/agent/loopBase';
import { OmpSession } from './session';
import { ompLocalLauncher } from './ompLocalLauncher';
import { ompRemoteLauncher } from './ompRemoteLauncher';
import { ApiClient, ApiSessionClient } from '@/lib';
import type { OmpMode, PermissionMode } from './types';

interface OmpLoopOptions {
    path: string;
    startingMode?: 'local' | 'remote';
    startedBy?: 'runner' | 'terminal';
    onModeChange: (mode: 'local' | 'remote') => void;
    messageQueue: MessageQueue2<OmpMode>;
    session: ApiSessionClient;
    api: ApiClient;
    permissionMode?: PermissionMode;
    model?: string;
    resumeSessionId?: string;
    onSessionReady?: (session: OmpSession) => void;
}

export async function ompLoop(opts: OmpLoopOptions): Promise<void> {
    const logPath = logger.getLogPath();
    const startedBy = opts.startedBy ?? 'terminal';
    const startingMode = opts.startingMode ?? 'local';

    const session = new OmpSession({
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
        permissionMode: opts.permissionMode ?? 'default'
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
        logTag: 'omp-loop',
        runLocal: (instance) => ompLocalLauncher(instance, {
            model: getCurrentModel()
        }),
        runRemote: (instance) => ompRemoteLauncher(instance, {
            model: getCurrentModel()
        }),
        onSessionReady: opts.onSessionReady
    });
}
