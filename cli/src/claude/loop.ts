import { ApiSessionClient } from "@/api/apiSession"
import { MessageQueue2 } from "@/utils/MessageQueue2"
import { logger } from "@/ui/logger"
import { runLocalRemoteSession } from "@/agent/loopBase"
import { Session } from "./session"
import { claudeLocalLauncher } from "./claudeLocalLauncher"
import { claudeRemoteLauncher } from "./claudeRemoteLauncher"
import { ApiClient } from "@/lib"
import type { SessionEffort, SessionModel } from "@/api/types"
import type { ClaudePermissionMode } from "@hapi/protocol/types"
import { createSessionScanner } from './utils/sessionScanner'
import { sendClaudeTranscriptMessage } from './utils/sendTranscriptMessage'

export type PermissionMode = ClaudePermissionMode;

export interface EnhancedMode {
    permissionMode: PermissionMode;
    model?: string;
    effort?: string;
    fallbackModel?: string;
    customSystemPrompt?: string;
    appendSystemPrompt?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
}

interface LoopOptions {
    path: string
    model?: SessionModel
    effort?: SessionEffort
    permissionMode?: PermissionMode
    startingMode?: 'local' | 'remote'
    startedBy?: 'runner' | 'terminal'
    onModeChange: (mode: 'local' | 'remote') => void
    mcpServers: Record<string, any>
    session: ApiSessionClient
    api: ApiClient,
    claudeEnvVars?: Record<string, string>
    claudeArgs?: string[]
    messageQueue: MessageQueue2<EnhancedMode>
    allowedTools?: string[]
    onSessionReady?: (session: Session) => void
    hookSettingsPath: string
    resumeSessionId?: string
    replayTranscriptHistoryOnStart?: boolean
    historyImport?: boolean
}

export async function loop(opts: LoopOptions) {

    // Get log path for debug display
    const logPath = logger.logFilePath;
    const startedBy = opts.startedBy ?? 'terminal';
    const startingMode = opts.startingMode ?? 'local';
    const session = new Session({
        api: opts.api,
        client: opts.session,
        path: opts.path,
        sessionId: opts.resumeSessionId ?? null,
        claudeEnvVars: opts.claudeEnvVars,
        claudeArgs: opts.claudeArgs,
        mcpServers: opts.mcpServers,
        logPath: logPath,
        messageQueue: opts.messageQueue,
        allowedTools: opts.allowedTools,
        onModeChange: opts.onModeChange,
        mode: startingMode,
        startedBy,
        startingMode,
        hookSettingsPath: opts.hookSettingsPath,
        permissionMode: opts.permissionMode ?? 'default',
        model: opts.model,
        effort: opts.effort
    });

    if (opts.replayTranscriptHistoryOnStart && session.sessionId) {
        const externalSessionId = session.sessionId;
        session.onSessionFound(externalSessionId, opts.historyImport ? {
            historyImport: { type: 'importing', provider: 'claude', externalSessionId, startedAt: Date.now() }
        } : undefined);
        let messageCount = 0;
        try {
            const replay = await createSessionScanner({
                sessionId: externalSessionId,
                workingDirectory: session.path,
                replayExistingHistory: true,
                onMessage: (message) => { if (sendClaudeTranscriptMessage(session, message)) messageCount += 1 }
            });
            await replay.cleanup();
            if (opts.historyImport) {
                session.client.updateMetadata((metadata) => ({
                    ...metadata,
                    historyImport: { type: 'completed', provider: 'claude', externalSessionId, completedAt: Date.now(), messageCount }
                }));
                await session.client.flushMetadata();
                return;
            }
        } catch (error) {
            if (opts.historyImport) {
                session.client.updateMetadata((metadata) => ({
                    ...metadata,
                    historyImport: { type: 'failed', provider: 'claude', externalSessionId, failedAt: Date.now(), error: error instanceof Error ? error.message : String(error) }
                }));
                await session.client.flushMetadata();
            }
            throw error;
        }
    }

    await runLocalRemoteSession({
        session,
        startingMode: opts.startingMode,
        logTag: 'loop',
        runLocal: claudeLocalLauncher,
        runRemote: claudeRemoteLauncher,
        onSessionReady: opts.onSessionReady
    });
}
