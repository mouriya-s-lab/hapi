import { AcpSdkBackend } from '@/agent/backends/acp';
import { buildGrokEnv } from './config';

function filterEnv(env: NodeJS.ProcessEnv): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}

export function buildGrokAgentArgs(opts: { model?: string; permissionMode?: string }): string[] {
    const args = ['--permission-mode', 'default', 'agent'];
    if (opts.model) args.push('--model', opts.model);
    args.push('stdio');
    return args;
}

export function createGrokBackend(opts: {
    model?: string;
    resumeSessionId?: string | null;
    cwd?: string;
    permissionMode?: string;
}): AcpSdkBackend {
    const env = filterEnv(buildGrokEnv({ model: opts.model, cwd: opts.cwd }));
    const args = buildGrokAgentArgs(opts);

    return new AcpSdkBackend({
        command: 'grok',
        args,
        env
    });
}
