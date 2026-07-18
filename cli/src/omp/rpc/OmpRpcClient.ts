import { spawn } from 'node:child_process';
import { parseOmpResponseData } from './schemas';
import {
    OmpRpcRequestError,
    OmpRpcTransport,
    type OmpRpcRequestOptions
} from './OmpRpcTransport';
import type {
    OmpCommand,
    OmpCommandByType,
    OmpCommandType,
    OmpInboundEvent,
    OmpOutboundControlFrame,
    OmpResponseData,
    OmpRpcDiscovery,
    OmpRpcSpawnConfig,
    OmpRpcTransportState
} from './types';
import type { OmpRpcTransportDependencies } from './OmpRpcTransport';

const MINIMUM_OMP_RPC_VERSION = [17, 0, 4] as const;
const VERSION_PROBE_TIMEOUT_MS = 5_000;

export type OmpVersion = {
    raw: string;
    major: number;
    minor: number;
    patch: number;
};

type VersionProbe = (command: string, env?: NodeJS.ProcessEnv) => Promise<OmpVersion>;

export function parseOmpVersion(output: string): OmpVersion {
    const match = /(?:omp\/)?(\d+)\.(\d+)\.(\d+)/.exec(output.trim());
    if (!match) {
        throw new Error(`Unable to parse OMP version from: ${output.trim() || '<empty>'}`);
    }
    return {
        raw: output.trim(),
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3])
    };
}

export function assertSupportedOmpVersion(version: OmpVersion): void {
    const actual = [version.major, version.minor, version.patch] as const;
    for (let index = 0; index < actual.length; index += 1) {
        if (actual[index] > MINIMUM_OMP_RPC_VERSION[index]) {
            return;
        }
        if (actual[index] < MINIMUM_OMP_RPC_VERSION[index]) {
            throw new Error(
                `OMP ${version.major}.${version.minor}.${version.patch} is too old; HAPI requires OMP 17.0.4 or newer for RPC mode`
            );
        }
    }
}

export async function probeOmpVersion(
    command: string = 'omp',
    env?: NodeJS.ProcessEnv
): Promise<OmpVersion> {
    const child = spawn(command, ['--version'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        windowsHide: process.platform === 'win32'
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
    });

    return new Promise<OmpVersion>((resolve, reject) => {
        let settled = false;
        const finish = (outcome: { version: OmpVersion } | { error: Error }) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            if ('error' in outcome) {
                reject(outcome.error);
            } else {
                resolve(outcome.version);
            }
        };
        const timeout = setTimeout(() => {
            child.kill('SIGTERM');
            finish({ error: new Error(`Timed out waiting for ${command} --version`) });
        }, VERSION_PROBE_TIMEOUT_MS);
        timeout.unref();

        child.on('error', (error: Error) => {
            const message = (error as NodeJS.ErrnoException).code === 'ENOENT'
                ? `${command} was not found on PATH`
                : `Failed to run ${command} --version: ${error.message}`;
            finish({ error: new Error(message, { cause: error }) });
        });
        child.on('close', (code) => {
            if (code !== 0) {
                finish({ error: new Error(
                    `${command} --version exited with ${code ?? 'null'}${stderr ? `: ${stderr.trim()}` : ''}`
                ) });
                return;
            }
            try {
                finish({ version: parseOmpVersion(stdout) });
            } catch (error) {
                finish({ error: error instanceof Error ? error : new Error(String(error)) });
            }
        });
    });
}

export class OmpRpcClient {
    private constructor(
        private readonly transport: OmpRpcTransport,
        readonly discovery: OmpRpcDiscovery
    ) {}

    static async connect(
        config: OmpRpcSpawnConfig,
        options: {
            readyTimeoutMs?: number;
            probeVersion?: VersionProbe;
            transportDependencies?: Partial<OmpRpcTransportDependencies>;
        } = {}
    ): Promise<OmpRpcClient> {
        const command = config.command ?? 'omp';
        const version = await (options.probeVersion ?? probeOmpVersion)(command, config.env);
        assertSupportedOmpVersion(version);

        const transport = await OmpRpcTransport.connect(config, {
            readyTimeoutMs: options.readyTimeoutMs,
            dependencies: options.transportDependencies
        });
        try {
            const [state, commands, models] = await Promise.all([
                OmpRpcClient.requestThrough(transport, { type: 'get_state' }, { discovery: true }),
                OmpRpcClient.requestThrough(transport, { type: 'get_available_commands' }, { discovery: true }),
                OmpRpcClient.requestThrough(transport, { type: 'get_available_models' }, { discovery: true })
            ]);
            transport.markReady();
            return new OmpRpcClient(transport, {
                version: `${version.major}.${version.minor}.${version.patch}`,
                state,
                commands: commands.commands,
                models: models.models
            });
        } catch (error) {
            await transport.close(error instanceof Error ? error : new Error(String(error)), 0);
            throw error;
        }
    }

    get state(): OmpRpcTransportState {
        return this.transport.state;
    }

    get stderrText(): string {
        return this.transport.stderrText;
    }

    onEvent(listener: (event: OmpInboundEvent) => void): () => void {
        return this.transport.onEvent(listener);
    }

    onDiagnostic(listener: (message: string) => void): () => void {
        return this.transport.onDiagnostic(listener);
    }

    onClosed(listener: (reason: Error) => void): () => void {
        return this.transport.onClosed(listener);
    }

    request<C extends OmpCommandType>(
        command: OmpCommandByType<C>,
        options: Omit<OmpRpcRequestOptions, 'discovery'> = {}
    ): Promise<OmpResponseData<C>> {
        return OmpRpcClient.requestThrough(this.transport, command, options);
    }

    sendControlFrame(frame: OmpOutboundControlFrame): Promise<void> {
        return this.transport.sendControlFrame(frame);
    }

    close(reason?: Error): Promise<void> {
        return this.transport.close(reason);
    }

    private static async requestThrough<C extends OmpCommandType>(
        transport: OmpRpcTransport,
        command: OmpCommandByType<C>,
        options: OmpRpcRequestOptions
    ): Promise<OmpResponseData<C>> {
        const response = await transport.request(command, options);
        if (!response.success) {
            throw new OmpRpcRequestError(command.type, response.error);
        }
        return parseOmpResponseData(command.type, response.data);
    }
}
