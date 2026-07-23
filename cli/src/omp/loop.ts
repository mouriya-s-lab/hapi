import { logger } from '@/ui/logger';
import { runLocalRemoteSession } from '@/agent/loopBase';
import { OmpSession } from './session';
import { ompLocalLauncher } from './ompLocalLauncher';
import { ompRemoteLauncher } from './ompRemoteLauncher';
import { ApiClient, ApiSessionClient } from '@/lib';
import type { OmpMode, PermissionMode } from './types';
import type { OmpNativeSession } from '@hapi/protocol/types';
import type { OmpConfiguredThinkingLevel } from '@hapi/protocol/omp';
import type { OmpInputQueue } from './OmpInputQueue';

interface OmpLoopOptions {
    path: string;
    startingMode?: 'local' | 'remote';
    startedBy?: 'runner' | 'terminal';
    onModeChange: (mode: 'local' | 'remote') => void;
    messageQueue: OmpInputQueue;
    session: ApiSessionClient;
    api: ApiClient;
    permissionMode?: PermissionMode;
    model?: string;
    effort?: OmpConfiguredThinkingLevel;
    resumeSessionId?: string;
    nativeSession?: OmpNativeSession;
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
        permissionMode: opts.permissionMode ?? 'default',
        model: opts.model,
        effort: opts.effort,
        nativeSession: opts.nativeSession
    });

    const getCurrentModel = (): string | undefined => {
        const sessionModel = session.getModel();
        return sessionModel != null ? sessionModel : opts.model;
    };

    await runLocalRemoteSession({
        session,
        startingMode: opts.startingMode,
        logTag: 'omp-loop',
        runLocal: (instance) => ompLocalLauncher(instance, {
            model: getCurrentModel(),
            effort: instance.getEffort() as OmpConfiguredThinkingLevel | undefined
        }),
        runRemote: (instance) => ompRemoteLauncher(instance),
        onSessionReady: opts.onSessionReady
    });
}
