import { RawJSONLines, RawJSONLinesSchema } from "../types";
import { basename, join } from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { logger } from "@/ui/logger";
import { getProjectPath } from "./path";
import { BaseSessionScanner, SessionFileScanEntry, SessionFileScanResult, SessionFileScanStats } from "@/modules/common/session/BaseSessionScanner";

/**
 * Known internal Claude Code event types that should be silently skipped.
 * These are written to session JSONL files by Claude Code but are not 
 * actual conversation messages - they're internal state/tracking events.
 */
const INTERNAL_CLAUDE_EVENT_TYPES = new Set([
    'file-history-snapshot',
    'change',
    'queue-operation',
]);

export async function createSessionScanner(opts: {
    sessionId: string | null;
    workingDirectory: string;
    onMessage: (message: RawJSONLines) => void;
    replayExistingHistory?: boolean;
}) {
    const scanner = new ClaudeSessionScanner({
        sessionId: opts.sessionId,
        workingDirectory: opts.workingDirectory,
        onMessage: opts.onMessage,
        replayExistingHistory: opts.replayExistingHistory ?? false
    });

    await scanner.start();

    return {
        cleanup: async () => {
            await scanner.cleanup();
        },
        onNewSession: (sessionId: string) => {
            scanner.onNewSession(sessionId);
        }
    };
}

export type SessionScanner = ReturnType<typeof createSessionScanner>;


class ClaudeSessionScanner extends BaseSessionScanner<RawJSONLines> {
    private readonly projectDir: string;
    private readonly onMessage: (message: RawJSONLines) => void;
    private readonly finishedSessions = new Set<string>();
    private readonly pendingSessions = new Set<string>();
    private currentSessionId: string | null;
    private readonly scannedSessions = new Set<string>();
    private readonly replayExistingHistory: boolean;

    constructor(opts: { sessionId: string | null; workingDirectory: string; onMessage: (message: RawJSONLines) => void; replayExistingHistory: boolean }) {
        super({ intervalMs: 3000 });
        this.projectDir = getProjectPath(opts.workingDirectory);
        this.onMessage = opts.onMessage;
        this.currentSessionId = opts.sessionId;
        this.replayExistingHistory = opts.replayExistingHistory;
    }

    public onNewSession(sessionId: string): void {
        if (this.currentSessionId === sessionId) {
            logger.debug(`[SESSION_SCANNER] New session: ${sessionId} is the same as the current session, skipping`);
            return;
        }
        if (this.finishedSessions.has(sessionId)) {
            logger.debug(`[SESSION_SCANNER] New session: ${sessionId} is already finished, skipping`);
            return;
        }
        if (this.pendingSessions.has(sessionId)) {
            logger.debug(`[SESSION_SCANNER] New session: ${sessionId} is already pending, skipping`);
            return;
        }
        if (this.currentSessionId) {
            this.pendingSessions.add(this.currentSessionId);
        }
        logger.debug(`[SESSION_SCANNER] New session: ${sessionId}`);
        this.currentSessionId = sessionId;
        this.invalidate();
    }

    protected async initialize(): Promise<void> {
        if (!this.currentSessionId) {
            return;
        }
        const sessionFile = this.sessionFilePath(this.currentSessionId);
        if (this.replayExistingHistory) {
            const totalLines = await replaySessionLog(sessionFile, (message) => {
                this.seedProcessedKeys([messageKey(message)]);
                this.onMessage(message);
            });
            this.setCursor(sessionFile, totalLines);
            return;
        }
        const { events, totalLines } = await readSessionLog(sessionFile, 0);
        logger.debug(`[SESSION_SCANNER] Marking ${events.length} existing messages as processed from session ${this.currentSessionId}`);
        const keys = events.map((entry) => messageKey(entry.event));
        this.seedProcessedKeys(keys);
        this.setCursor(sessionFile, totalLines);
    }

    protected async beforeScan(): Promise<void> {
        this.scannedSessions.clear();
    }

    protected async findSessionFiles(): Promise<string[]> {
        const files = new Set<string>();
        for (const sessionId of this.pendingSessions) {
            files.add(this.sessionFilePath(sessionId));
        }
        if (this.currentSessionId && !this.pendingSessions.has(this.currentSessionId)) {
            files.add(this.sessionFilePath(this.currentSessionId));
        }
        for (const watched of this.getWatchedFiles()) {
            files.add(watched);
        }
        return [...files];
    }

    protected async parseSessionFile(filePath: string, cursor: number): Promise<SessionFileScanResult<RawJSONLines>> {
        const sessionId = sessionIdFromPath(filePath);
        if (sessionId) {
            this.scannedSessions.add(sessionId);
        }
        const { events, totalLines } = await readSessionLog(filePath, cursor);
        return {
            events,
            nextCursor: totalLines
        };
    }

    protected generateEventKey(event: RawJSONLines): string {
        return messageKey(event);
    }

    protected async handleFileScan(stats: SessionFileScanStats<RawJSONLines>): Promise<void> {
        for (const message of stats.events) {
            const id = message.type === 'summary' ? message.leafUuid : message.uuid;
            logger.debug(`[SESSION_SCANNER] Sending new message: type=${message.type}, uuid=${id}`);
            this.onMessage(message);
        }
        if (stats.parsedCount > 0) {
            const sessionId = sessionIdFromPath(stats.filePath) ?? 'unknown';
            logger.debug(`[SESSION_SCANNER] Session ${sessionId}: found=${stats.parsedCount}, skipped=${stats.skippedCount}, sent=${stats.newCount}`);
        }
    }

    protected async afterScan(): Promise<void> {
        for (const sessionId of this.scannedSessions) {
            if (this.pendingSessions.has(sessionId)) {
                this.pendingSessions.delete(sessionId);
                this.finishedSessions.add(sessionId);
            }
        }
    }

    private sessionFilePath(sessionId: string): string {
        return join(this.projectDir, `${sessionId}.jsonl`);
    }
}

//
// Helpers
//

function messageKey(message: RawJSONLines): string {
    if (message.type === 'user') {
        return message.uuid;
    } else if (message.type === 'assistant') {
        return message.uuid;
    } else if (message.type === 'summary') {
        return 'summary: ' + message.leafUuid + ': ' + message.summary;
    } else if (message.type === 'system') {
        return message.uuid;
    } else {
        throw Error() // Impossible
    }
}

function parseSessionLogLine(line: string): RawJSONLines | null {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Claude transcript line is not an object');
    }
    const record = value as Record<string, unknown>;
    if (typeof record.type === 'string' && INTERNAL_CLAUDE_EVENT_TYPES.has(record.type)) return null;
    const parsed = RawJSONLinesSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

async function replaySessionLog(filePath: string, onMessage: (message: RawJSONLines) => void): Promise<number> {
    logger.debug(`[SESSION_SCANNER] Replaying session file: ${filePath}`);
    const input = createReadStream(filePath, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    let totalLines = 0;
    try {
        for await (const line of lines) {
            totalLines += 1;
            if (!line.trim()) continue;
            const message = parseSessionLogLine(line);
            if (message) onMessage(message);
        }
    } finally {
        lines.close();
        input.destroy();
    }
    return totalLines;
}

/**
 * Read and parse session log file.
 * Returns only valid conversation messages, silently skipping internal events.
 */
async function readSessionLog(filePath: string, startLine: number): Promise<{ events: SessionFileScanEntry<RawJSONLines>[]; totalLines: number }> {
    logger.debug(`[SESSION_SCANNER] Reading session file: ${filePath}`);
    const messages: SessionFileScanEntry<RawJSONLines>[] = [];
    const input = createReadStream(filePath, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    let totalLines = 0;
    try {
        for await (const line of lines) {
            const index = totalLines;
            totalLines += 1;
            if (index < startLine || !line.trim()) continue;
            try {
                const message = parseSessionLogLine(line);
                if (message) messages.push({ event: message, lineIndex: index });
            } catch (error) {
                logger.debug(`[SESSION_SCANNER] Error processing message: ${error}`);
            }
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            logger.debug(`[SESSION_SCANNER] Session file not found: ${filePath}`);
            return { events: [], totalLines: startLine };
        }
        throw error;
    } finally {
        lines.close();
        input.destroy();
    }
    if (startLine > totalLines) return readSessionLog(filePath, 0);
    return { events: messages, totalLines };
}

function sessionIdFromPath(filePath: string): string | null {
    const base = basename(filePath);
    if (!base.endsWith('.jsonl')) {
        return null;
    }
    return base.slice(0, -'.jsonl'.length);
}
