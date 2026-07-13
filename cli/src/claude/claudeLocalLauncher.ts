import { claudeLocal } from "./claudeLocal";
import { Session } from "./session";
import { createSessionScanner } from "./utils/sessionScanner";
import { sendClaudeTranscriptMessage } from './utils/sendTranscriptMessage'
import { BaseLocalLauncher } from "@/modules/common/launcher/BaseLocalLauncher";

export async function claudeLocalLauncher(session: Session): Promise<'switch' | 'exit'> {

    // Create scanner
    const scanner = await createSessionScanner({
        sessionId: session.sessionId,
        workingDirectory: session.path,
        onMessage: (message) => sendClaudeTranscriptMessage(session, message)
    });

    const handleSessionFound = (sessionId: string) => {
        scanner.onNewSession(sessionId);
    };
    session.addSessionFoundCallback(handleSessionFound);


    const launcher = new BaseLocalLauncher({
        label: 'local',
        failureLabel: 'Local Claude process failed',
        queue: session.queue,
        rpcHandlerManager: session.client.rpcHandlerManager,
        startedBy: session.startedBy,
        startingMode: session.startingMode,
        launch: async (abortSignal) => {
            await claudeLocal({
                path: session.path,
                sessionId: session.sessionId,
                abort: abortSignal,
                claudeEnvVars: session.claudeEnvVars,
                claudeArgs: session.claudeArgs,
                mcpServers: session.mcpServers,
                allowedTools: session.allowedTools,
                hookSettingsPath: session.hookSettingsPath,
            });
        },
        onLaunchSuccess: () => {
            session.consumeOneTimeFlags();
        },
        sendFailureMessage: (message) => {
            session.client.sendSessionEvent({ type: 'message', message });
        },
        recordLocalLaunchFailure: (message, exitReason) => {
            session.recordLocalLaunchFailure(message, exitReason);
        },
        abortLogMessage: 'doAbort',
        switchLogMessage: 'doSwitch'
    });
    try {
        return await launcher.run();
    } finally {
        // Cleanup
        session.removeSessionFoundCallback(handleSessionFound);
        await scanner.cleanup();
    }
}
