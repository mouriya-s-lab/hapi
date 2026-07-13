import { logger } from '@/ui/logger';
import { spawnWithTerminalGuard } from '@/utils/spawnWithTerminalGuard';

export function buildGrokLocalArgs(opts: {
    sessionId: string | null;
    createSession?: boolean;
    model?: string;
    reasoningEffort?: string | null;
}): string[] {
    const args: string[] = [];
    if (opts.sessionId) args.push(opts.createSession ? '--session-id' : '--resume', opts.sessionId);
    if (opts.createSession && opts.model) args.push('--model', opts.model);
    if (opts.createSession && opts.reasoningEffort) args.push('--reasoning-effort', opts.reasoningEffort);
    return args;
}

export async function grokLocal(opts: {
    path: string;
    sessionId: string | null;
    createSession?: boolean;
    abort: AbortSignal;
    model?: string;
    reasoningEffort?: string | null;
}): Promise<void> {
    const args = buildGrokLocalArgs(opts);
    const env: NodeJS.ProcessEnv = {
        ...process.env
    };

    logger.debug(`[GrokLocal] Spawning grok with args: ${JSON.stringify(args)}`);

    await spawnWithTerminalGuard({
        command: 'grok',
        args,
        cwd: opts.path,
        env,
        signal: opts.abort,
        shell: process.platform === 'win32',
        logLabel: 'GrokLocal',
        spawnName: 'grok',
        installHint: 'Grok CLI',
        includeCause: true,
        logExit: true
    });
}
