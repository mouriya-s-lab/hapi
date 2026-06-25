import { logger } from '@/ui/logger';
import { spawnWithTerminalGuard } from '@/utils/spawnWithTerminalGuard';

export async function ompLocal(opts: {
    path: string;
    sessionId: string | null;
    abort: AbortSignal;
    model?: string;
    yolo?: boolean;
}): Promise<void> {
    const args: string[] = [];

    if (opts.sessionId) {
        args.push('--resume', opts.sessionId);
    }
    if (opts.model) {
        args.push('--model', opts.model);
    }
    if (opts.yolo) {
        args.push('--approval-mode', 'yolo');
    }

    const env: NodeJS.ProcessEnv = {
        ...process.env
    };

    logger.debug(`[OmpLocal] Spawning omp with args: ${JSON.stringify(args)}`);

    await spawnWithTerminalGuard({
        command: 'omp',
        args,
        cwd: opts.path,
        env,
        signal: opts.abort,
        shell: process.platform === 'win32',
        logLabel: 'OmpLocal',
        spawnName: 'omp',
        installHint: 'Oh My Pi (omp)',
        includeCause: true,
        logExit: true
    });
}
