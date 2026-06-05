import { ompLocal } from './ompLocal';
import { OmpSession } from './session';
import type { PermissionMode } from './types';
import { BaseLocalLauncher } from '@/modules/common/launcher/BaseLocalLauncher';

function mapApprovalMode(mode: PermissionMode | undefined): { yolo: boolean } {
    if (mode === 'yolo' || mode === 'safe-yolo') {
        return { yolo: true };
    }
    return { yolo: false };
}

export async function ompLocalLauncher(
    session: OmpSession,
    opts: {
        model?: string;
    }
): Promise<'switch' | 'exit'> {
    const launcher = new BaseLocalLauncher({
        label: 'omp-local',
        failureLabel: 'Local omp process failed',
        queue: session.queue,
        rpcHandlerManager: session.client.rpcHandlerManager,
        startedBy: session.startedBy,
        startingMode: session.startingMode,
        launch: async (abortSignal) => {
            const approval = mapApprovalMode(session.getPermissionMode() as PermissionMode | undefined);
            await ompLocal({
                path: session.path,
                sessionId: session.sessionId,
                abort: abortSignal,
                model: opts.model,
                yolo: approval.yolo
            });
        },
        sendFailureMessage: (message) => {
            session.sendSessionEvent({ type: 'message', message });
        },
        recordLocalLaunchFailure: (message, exitReason) => {
            session.recordLocalLaunchFailure(message, exitReason);
        }
    });

    return await launcher.run();
}
