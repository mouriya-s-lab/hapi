import { ompLocal } from './ompLocal';
import { OmpSession } from './session';
import { BaseLocalLauncher } from '@/modules/common/launcher/BaseLocalLauncher';
import { createOmpLocalSessionScanner } from './utils/ompSessionScanner';
import { buildOmpEnv } from './utils/config';
import type { OmpConfiguredThinkingLevel } from '@hapi/protocol/omp';

export async function ompLocalLauncher(
    session: OmpSession,
    opts: {
        model?: string;
        effort?: OmpConfiguredThinkingLevel;
    }
): Promise<'switch' | 'exit'> {
    const scanner = createOmpLocalSessionScanner({
        workingDirectory: session.path,
        env: buildOmpEnv(),
        onSnapshot: session.applyNativeSessionSnapshot
    });
    await scanner.start();

    const launcher = new BaseLocalLauncher({
        label: 'omp-local',
        failureLabel: 'Local omp process failed',
        queue: session.queue,
        rpcHandlerManager: session.client.rpcHandlerManager,
        startedBy: session.startedBy,
        startingMode: session.startingMode,
        launch: async (abortSignal) => {
            await ompLocal({
                path: session.path,
                sessionId: session.sessionId,
                abort: abortSignal,
                model: opts.model,
                effort: opts.effort
            });
        },
        sendFailureMessage: (message) => {
            session.sendSessionEvent({ type: 'message', message });
        },
        recordLocalLaunchFailure: (message, exitReason) => {
            session.recordLocalLaunchFailure(message, exitReason);
        }
    });

    try {
        return await launcher.run();
    } finally {
        await scanner.cleanup();
    }
}
