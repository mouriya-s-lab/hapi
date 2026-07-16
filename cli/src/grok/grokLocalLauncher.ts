import { grokLocal } from './grokLocal';
import { GrokSession } from './session';
import { BaseLocalLauncher } from '@/modules/common/launcher/BaseLocalLauncher';
import type { GrokSessionController } from './sessionController';

export async function grokLocalLauncher(
    session: GrokSession,
    opts: {
        model?: string;
        controller: GrokSessionController;
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
            const identity = opts.controller.reserveLocalSessionId();
            const createSession = identity.createSession;
            if (session.sessionId !== identity.sessionId) session.onSessionFound(identity.sessionId);
            opts.controller.commitSessionId(identity.sessionId);
            // HAPI yolo is a remote ACP permission overlay, not native Grok
            // session state. Local control always returns to Grok's native policy.
            session.setPermissionMode('default');
            opts.controller.setControl({ kind: 'local' });
            await grokLocal({
                path: session.path,
                sessionId: session.sessionId,
                createSession,
                abort: abortSignal,
                model: opts.model,
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
