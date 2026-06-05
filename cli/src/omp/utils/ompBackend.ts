import { AcpSdkBackend } from '@/agent/backends/acp';
import { buildOmpEnv } from './config';

function filterEnv(env: NodeJS.ProcessEnv): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}

export function createOmpBackend(opts: {
    model?: string;
    resumeSessionId?: string | null;
    cwd?: string;
    permissionMode?: string;
}): AcpSdkBackend {
    const env = filterEnv(buildOmpEnv({ model: opts.model }));

    // `omp acp` runs Oh My Pi as an ACP (Agent Client Protocol) server over stdio.
    // The model is passed via the global `--model` flag; omp resolves auth/provider
    // from its own ~/.omp config, so we only forward a model when one was chosen.
    const args = ['acp'];
    if (opts.model) {
        args.push('--model', opts.model);
    }

    return new AcpSdkBackend({
        command: 'omp',
        args,
        env
    });
}
