import { grokLocal } from './grokLocal';
import { GrokSession } from './session';
import type { PermissionMode } from './types';
import { BaseLocalLauncher } from '@/modules/common/launcher/BaseLocalLauncher';

function mapApprovalMode(mode: PermissionMode | undefined): { yolo: boolean; plan: boolean } {
    if (!mode || mode === 'default') {
        return { yolo: false, plan: false };
    }
    if (mode === 'yolo') {
        return { yolo: true, plan: false };
    }
    return { yolo: false, plan: false };
}

export async function grokLocalLauncher(
    session: GrokSession,
    opts: {
        model?: string;
    }
): Promise<'switch' | 'exit'> {
    const launcher = new BaseLocalLauncher({
        label: 'grok-local',
        failureLabel: 'Local Grok process failed',
        queue: session.queue,
        rpcHandlerManager: session.client.rpcHandlerManager,
        startedBy: session.startedBy,
        startingMode: session.startingMode,
        launch: async (abortSignal) => {
            const approval = mapApprovalMode(session.getPermissionMode() as PermissionMode | undefined);
            await grokLocal({
                path: session.path,
                sessionId: session.sessionId,
                abort: abortSignal,
                model: opts.model,
                yolo: approval.yolo,
                plan: approval.plan,
                reasoningEffort: session.getModelReasoningEffort()
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
