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
    cwd?: string;
} = {}): AcpSdkBackend {
    // `omp acp` runs Oh My Pi as an ACP (Agent Client Protocol) server over
    // stdio. We never bake `--model` into the spawn: omp resolves its own
    // default model from its `~/.omp` config and reports the full model list
    // (plus the current selection) over ACP via SessionModelState. Inline model
    // switching happens through `session/set_model` (see AcpSdkBackend.setModel),
    // so a single static spawn arg would only fight the dynamic path.
    const env = filterEnv(buildOmpEnv());

    return new AcpSdkBackend({
        command: 'omp',
        args: ['acp'],
        env
    });
}
