import { ompLocal } from './ompLocal';
import { OmpSession } from './session';
import type { PermissionMode } from './types';
import { BaseLocalLauncher } from '@/modules/common/launcher/BaseLocalLauncher';
import { createOmpLocalSessionScanner } from './utils/ompSessionScanner';
import { buildOmpEnv } from './utils/config';

function mapApprovalMode(mode: PermissionMode | undefined): { yolo: boolean } {
    // omp's real CLI exposes `--approval-mode {always-ask|write|yolo}`
    // (packages/coding-agent/src/cli/args.ts). HAPI only drives the yolo bit:
    // `yolo` maps to `--approval-mode yolo`; `default`/`plan` leave omp at its
    // own default (interactive approvals). `safe-yolo` no longer exists.
    if (mode === 'yolo') {
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

    try {
        return await launcher.run();
    } finally {
        await scanner.cleanup();
    }
}
