export const OMP_MODEL_ENV = 'OMP_MODEL';

export type OmpModelSource = 'explicit' | 'env' | 'default';

export type OmpRuntimeConfig = {
    /**
     * The model id to hand omp via `--model`. When undefined, omp resolves the
     * model itself from its own `~/.omp` config / role defaults — omp ships with
     * 40+ providers and no single canonical default, so hapi never forces one.
     */
    model: string | undefined;
    modelSource: OmpModelSource;
};

export function resolveOmpRuntimeConfig(opts: { model?: string } = {}): OmpRuntimeConfig {
    if (opts.model && opts.model.trim().length > 0) {
        return { model: opts.model.trim(), modelSource: 'explicit' };
    }

    const envModel = process.env[OMP_MODEL_ENV];
    if (envModel && envModel.trim().length > 0) {
        return { model: envModel.trim(), modelSource: 'env' };
    }

    return { model: undefined, modelSource: 'default' };
}

export function buildOmpEnv(opts: { model?: string } = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        ...process.env
    };

    if (opts.model) {
        env[OMP_MODEL_ENV] = opts.model;
    }

    return env;
}
