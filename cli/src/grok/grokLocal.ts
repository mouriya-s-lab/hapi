import { logger } from '@/ui/logger';
import { spawnWithTerminalGuard } from '@/utils/spawnWithTerminalGuard';

export function buildGrokLocalArgs(opts: {
    sessionId: string | null;
    createSession?: boolean;
    model?: string;
    yolo?: boolean;
    reasoningEffort?: string | null;
}): string[] {
    const args: string[] = [];
    if (opts.sessionId) args.push(opts.createSession ? '--session-id' : '--resume', opts.sessionId);
    if (opts.model) args.push('--model', opts.model);
    if (opts.yolo) args.push('--always-approve');
    if (opts.reasoningEffort) args.push('--reasoning-effort', opts.reasoningEffort);
    return args;
}

export async function grokLocal(opts: {
    path: string;
    sessionId: string | null;
    createSession?: boolean;
    abort: AbortSignal;
    model?: string;
    yolo?: boolean;
    plan?: boolean;
    reasoningEffort?: string | null;
}): Promise<void> {
    const args = buildGrokLocalArgs(opts);
    if (opts.plan) throw new Error('Grok plan mode is not exposed by HAPI');

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
