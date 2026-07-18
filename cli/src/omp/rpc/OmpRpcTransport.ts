import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import type { Writable } from 'node:stream';
import { logger } from '@/ui/logger';
import { killProcessByChildProcess } from '@/utils/process';
import { parseOmpInboundLine } from './schemas';
import type {
    OmpCommand,
    OmpCommandType,
    OmpCommandWithId,
    OmpInboundEvent,
    OmpOutboundControlFrame,
    OmpRpcOutboundFrame,
    OmpRpcRawResponse,
    OmpRpcSpawnConfig,
    OmpRpcTransportState
} from './types';

const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CLOSE_GRACE_MS = 1_500;
const MAX_STDERR_CHARS = 100_000;

const DISCOVERY_COMMANDS: ReadonlySet<OmpCommandType> = new Set([
    'get_state',
    'get_available_commands',
    'get_available_models'
]);

type PendingRequest = {
    command: OmpCommandType;
    resolve: (response: OmpRpcRawResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    removeAbortListener: () => void;
};

export type OmpRpcSpawnProcess = (
    command: string,
    args: string[],
    options: SpawnOptions
) => ChildProcessWithoutNullStreams;

export type OmpRpcTransportDependencies = {
    spawnProcess: OmpRpcSpawnProcess;
    killProcess: typeof killProcessByChildProcess;
};

export type OmpRpcRequestOptions = {
    timeoutMs?: number;
    signal?: AbortSignal;
    discovery?: boolean;
};

export class OmpRpcProtocolError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'OmpRpcProtocolError';
    }
}

export class OmpRpcStateError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'OmpRpcStateError';
    }
}

export class OmpRpcRequestError extends Error {
    readonly command: OmpCommandType;

    constructor(command: OmpCommandType, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'OmpRpcRequestError';
        this.command = command;
    }
}

export function buildOmpRpcArgs(config: OmpRpcSpawnConfig): string[] {
    const args = ['--mode', 'rpc', '--yolo'];
    if (config.profile) {
        args.push(`--profile=${config.profile}`);
    }
    if (config.provider) {
        args.push('--provider', config.provider);
    }
    if (config.model) {
        args.push('--model', config.model);
    }
    if (config.resumeSessionId) {
        args.push('--resume', config.resumeSessionId);
    }
    if (config.forkSessionId) {
        args.push('--fork', config.forkSessionId);
    }
    return args;
}

export function buildOmpRpcSpawnOptions(config: OmpRpcSpawnConfig): SpawnOptions {
    return {
        cwd: config.cwd,
        env: config.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        windowsHide: process.platform === 'win32'
    };
}

export class OmpRpcTransport {
    private readonly child: ChildProcessWithoutNullStreams;
    private readonly dependencies: OmpRpcTransportDependencies;
    private readonly pending = new Map<string, PendingRequest>();
    private readonly eventListeners = new Set<(event: OmpInboundEvent) => void>();
    private readonly diagnosticListeners = new Set<(message: string) => void>();
    private readonly closeListeners = new Set<(reason: Error) => void>();
    private readonly readyPromise: Promise<void>;
    private readonly exitPromise: Promise<void>;
    private resolveReady!: () => void;
    private rejectReady!: (error: Error) => void;
    private resolveExit!: () => void;
    private requestCounter = 0;
    private stderr = '';
    private stateValue: OmpRpcTransportState = 'starting';
    private readySettled = false;
    private exitSettled = false;
    private closePromise: Promise<void> | null = null;
    private writeTail: Promise<void> = Promise.resolve();
    private closeReason: Error | null = null;

    private constructor(
        config: OmpRpcSpawnConfig,
        dependencies: OmpRpcTransportDependencies
    ) {
        this.dependencies = dependencies;
        this.readyPromise = new Promise<void>((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });
        this.exitPromise = new Promise<void>((resolve) => {
            this.resolveExit = resolve;
        });

        const command = config.command ?? 'omp';
        const args = buildOmpRpcArgs(config);
        logger.debug(`[omp-rpc] spawning ${command} ${args.join(' ')}`);
        this.child = dependencies.spawnProcess(
            command,
            args,
            buildOmpRpcSpawnOptions(config)
        ) as ChildProcessWithoutNullStreams;
        this.attachProcessListeners(command);
    }

    static async connect(
        config: OmpRpcSpawnConfig,
        options: {
            readyTimeoutMs?: number;
            dependencies?: Partial<OmpRpcTransportDependencies>;
        } = {}
    ): Promise<OmpRpcTransport> {
        const transport = new OmpRpcTransport(config, {
            spawnProcess: options.dependencies?.spawnProcess ?? ((command, args, spawnOptions) => (
                spawn(command, args, spawnOptions) as ChildProcessWithoutNullStreams
            )),
            killProcess: options.dependencies?.killProcess ?? killProcessByChildProcess
        });
        try {
            await transport.waitUntilDiscovering(options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
            return transport;
        } catch (error) {
            await transport.close(error instanceof Error ? error : new Error(String(error)), 0);
            throw error;
        }
    }

    get state(): OmpRpcTransportState {
        return this.stateValue;
    }

    get stderrText(): string {
        return this.stderr;
    }

    onEvent(listener: (event: OmpInboundEvent) => void): () => void {
        this.eventListeners.add(listener);
        return () => this.eventListeners.delete(listener);
    }

    onDiagnostic(listener: (message: string) => void): () => void {
        this.diagnosticListeners.add(listener);
        return () => this.diagnosticListeners.delete(listener);
    }

    onClosed(listener: (reason: Error) => void): () => void {
        if (this.stateValue === 'closed' && this.closeReason) {
            listener(this.closeReason);
            return () => {};
        }
        this.closeListeners.add(listener);
        return () => this.closeListeners.delete(listener);
    }

    markReady(): void {
        if (this.stateValue !== 'discovering') {
            throw new OmpRpcStateError(`Cannot mark OMP RPC ready from ${this.stateValue}`);
        }
        this.transitionTo('ready');
    }

    async request(command: OmpCommand, options: OmpRpcRequestOptions = {}): Promise<OmpRpcRawResponse> {
        this.assertCommandAllowed(command.type, options.discovery === true);
        if (options.signal?.aborted) {
            throw this.abortError(command.type, options.signal.reason);
        }

        const id = `hapi_${++this.requestCounter}`;
        const frame: OmpCommandWithId = { ...command, id };
        const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

        return new Promise<OmpRpcRawResponse>((resolve, reject) => {
            const timeout = setTimeout(() => {
                const pending = this.pending.get(id);
                if (!pending) {
                    return;
                }
                this.pending.delete(id);
                pending.removeAbortListener();
                reject(new OmpRpcRequestError(
                    command.type,
                    `OMP RPC ${command.type} timed out after ${timeoutMs}ms`
                ));
            }, timeoutMs);
            timeout.unref();

            const onAbort = () => {
                const pending = this.pending.get(id);
                if (!pending) {
                    return;
                }
                this.pending.delete(id);
                clearTimeout(timeout);
                reject(this.abortError(command.type, options.signal?.reason));
            };
            options.signal?.addEventListener('abort', onAbort, { once: true });

            const removeAbortListener = () => {
                options.signal?.removeEventListener('abort', onAbort);
            };
            this.pending.set(id, {
                command: command.type,
                resolve,
                reject,
                timeout,
                removeAbortListener
            });

            void this.enqueueWrite(frame).catch((error) => {
                this.failTransport(error instanceof Error ? error : new Error(String(error)));
            });
        });
    }

    sendControlFrame(frame: OmpOutboundControlFrame): Promise<void> {
        if (this.stateValue !== 'ready') {
            return Promise.reject(new OmpRpcStateError(
                `OMP RPC control frame ${frame.type} rejected in ${this.stateValue}`
            ));
        }
        return this.enqueueWrite(frame);
    }

    close(
        reason: Error = new OmpRpcStateError('OMP RPC transport closed'),
        graceMs: number = DEFAULT_CLOSE_GRACE_MS
    ): Promise<void> {
        if (this.stateValue === 'closed') {
            return Promise.resolve();
        }
        if (this.closePromise) {
            return this.closePromise;
        }
        this.closePromise = this.performClose(reason, graceMs);
        return this.closePromise;
    }

    private attachProcessListeners(command: string): void {
        this.child.stdin.on('error', (error: Error) => {
            this.failTransport(new OmpRpcStateError(`OMP RPC stdin failed: ${error.message}`));
        });

        this.child.stdout.setEncoding('utf8');
        this.child.stdout.on('data', (chunk: string) => this.handleStdout(chunk));

        this.child.stderr.setEncoding('utf8');
        this.child.stderr.on('data', (chunk: string) => {
            this.stderr = `${this.stderr}${chunk}`.slice(-MAX_STDERR_CHARS);
            logger.debug(`[omp-rpc][stderr] ${chunk.trimEnd()}`);
        });

        this.child.on('error', (error: Error) => {
            const message = (error as NodeJS.ErrnoException).code === 'ENOENT'
                ? `${command} was not found on PATH`
                : `Failed to start ${command}: ${error.message}`;
            this.failTransport(new OmpRpcStateError(message));
        });

        this.child.on('close', (code, signal) => {
            const detail = `OMP RPC process exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
            const reason = new OmpRpcStateError(`${detail}${this.stderr ? `: ${this.stderr.trim()}` : ''}`);
            if (this.stateValue !== 'closing' && this.stateValue !== 'closed') {
                this.rejectAll(reason);
            }
            if (!this.readySettled) {
                this.settleReady(reason);
            }
            this.finishClosed(reason);
        });
    }

    private stdoutBuffer = '';

    private handleStdout(chunk: string): void {
        this.stdoutBuffer += chunk;
        let newline = this.stdoutBuffer.indexOf('\n');
        while (newline >= 0) {
            const line = this.stdoutBuffer.slice(0, newline).trim();
            this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
            if (line.length > 0) {
                this.handleLine(line);
            }
            newline = this.stdoutBuffer.indexOf('\n');
        }
    }

    private handleLine(line: string): void {
        let parsed: ReturnType<typeof parseOmpInboundLine>;
        try {
            parsed = parseOmpInboundLine(line);
        } catch (error) {
            this.failTransport(new OmpRpcProtocolError(
                'Failed to parse OMP RPC stdout frame',
                { cause: error }
            ));
            return;
        }

        switch (parsed.kind) {
            case 'ready':
                if (this.stateValue !== 'starting') {
                    this.failTransport(new OmpRpcProtocolError(
                        `Received duplicate or late OMP RPC ready frame in ${this.stateValue}`
                    ));
                    return;
                }
                this.transitionTo('discovering');
                this.settleReady();
                return;
            case 'response':
                this.handleResponse(parsed.response);
                return;
            case 'event':
                for (const listener of this.eventListeners) {
                    listener(parsed.event);
                }
                return;
            default: {
                const exhaustive: never = parsed;
                return exhaustive;
            }
        }
    }

    private handleResponse(response: OmpRpcRawResponse): void {
        if (!response.id) {
            this.emitDiagnostic(`OMP RPC response for ${response.command} has no id`);
            return;
        }
        const pending = this.pending.get(response.id);
        if (!pending) {
            this.emitDiagnostic(`OMP RPC response has unknown id ${response.id} (${response.command})`);
            return;
        }
        if (pending.command !== response.command) {
            const error = new OmpRpcProtocolError(
                `OMP RPC response ${response.id} command mismatch: expected ${pending.command}, received ${response.command}`
            );
            this.pending.delete(response.id);
            this.settlePending(pending, error);
            this.failTransport(error);
            return;
        }

        this.pending.delete(response.id);
        clearTimeout(pending.timeout);
        pending.removeAbortListener();
        pending.resolve(response);
    }

    private assertCommandAllowed(command: OmpCommandType, discovery: boolean): void {
        if (discovery) {
            if (this.stateValue !== 'discovering') {
                throw new OmpRpcStateError(`OMP RPC discovery command ${command} rejected in ${this.stateValue}`);
            }
            if (!DISCOVERY_COMMANDS.has(command)) {
                throw new OmpRpcStateError(`${command} is not an OMP RPC discovery command`);
            }
            return;
        }
        if (this.stateValue !== 'ready') {
            throw new OmpRpcStateError(`OMP RPC business command ${command} rejected in ${this.stateValue}`);
        }
    }

    private async waitUntilDiscovering(timeoutMs: number): Promise<void> {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                this.readyPromise,
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new OmpRpcStateError(
                        `Timed out waiting ${timeoutMs}ms for OMP RPC ready frame${this.stderr ? `: ${this.stderr.trim()}` : ''}`
                    )), timeoutMs);
                    timeout.unref();
                })
            ]);
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }

    private settleReady(error?: Error): void {
        if (this.readySettled) {
            return;
        }
        this.readySettled = true;
        if (error) {
            this.rejectReady(error);
        } else {
            this.resolveReady();
        }
    }

    private enqueueWrite(frame: OmpRpcOutboundFrame): Promise<void> {
        const write = this.writeTail.then(() => this.writeFrame(frame));
        this.writeTail = write.catch(() => undefined);
        return write;
    }

    private writeFrame(frame: OmpRpcOutboundFrame): Promise<void> {
        if (this.stateValue === 'closing' || this.stateValue === 'closed') {
            return Promise.reject(new OmpRpcStateError('Cannot write to a closing OMP RPC transport'));
        }
        const line = `${JSON.stringify(frame)}\n`;
        return new Promise<void>((resolve, reject) => {
            const stdin: Writable = this.child.stdin;
            let callbackDone = false;
            let drainDone = false;
            let settled = false;

            const cleanup = () => {
                stdin.off('drain', onDrain);
                stdin.off('error', onError);
                stdin.off('close', onClose);
            };
            const finish = () => {
                if (settled || !callbackDone || !drainDone) {
                    return;
                }
                settled = true;
                cleanup();
                resolve();
            };
            const fail = (error: Error) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                reject(new OmpRpcStateError(`Failed writing OMP RPC stdin: ${error.message}`));
            };
            const onDrain = () => {
                drainDone = true;
                finish();
            };
            const onError = (error: Error) => fail(error);
            const onClose = () => fail(new Error('stdin closed'));

            stdin.once('error', onError);
            stdin.once('close', onClose);
            try {
                const accepted = stdin.write(line, (error?: Error | null) => {
                    if (error) {
                        fail(error);
                        return;
                    }
                    callbackDone = true;
                    finish();
                });
                drainDone = accepted;
                if (!accepted) {
                    stdin.once('drain', onDrain);
                }
                finish();
            } catch (error) {
                fail(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    private failTransport(error: Error): void {
        if (this.stateValue === 'closed' || this.stateValue === 'closing') {
            return;
        }
        logger.debug('[omp-rpc] fatal transport error', error);
        this.settleReady(error);
        this.rejectAll(error);
        void this.close(error, 0);
    }

    private rejectAll(error: Error): void {
        for (const pending of this.pending.values()) {
            this.settlePending(pending, error);
        }
        this.pending.clear();
    }

    private settlePending(pending: PendingRequest, error: Error): void {
        clearTimeout(pending.timeout);
        pending.removeAbortListener();
        pending.reject(error);
    }

    private async performClose(reason: Error, graceMs: number): Promise<void> {
        this.closeReason = reason;
        if (this.stateValue !== 'closing') {
            this.transitionTo('closing');
        }
        this.settleReady(reason);
        this.rejectAll(reason);

        try {
            this.child.stdin.end();
        } catch {
            // Process may already have closed its stdin.
        }

        const exitedCleanly = await this.waitForExit(graceMs);
        if (!exitedCleanly && this.stateValue !== 'closed') {
            await this.dependencies.killProcess(this.child);
            await this.waitForExit(1_000);
        }
        this.finishClosed(reason);
    }

    private async waitForExit(timeoutMs: number): Promise<boolean> {
        if (this.stateValue === 'closed') {
            return true;
        }
        if (timeoutMs <= 0) {
            return false;
        }
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
            this.exitPromise.then(() => true),
            new Promise<boolean>((resolve) => {
                timeout = setTimeout(() => resolve(false), timeoutMs);
                timeout.unref();
            })
        ]);
        if (timeout) {
            clearTimeout(timeout);
        }
        return result;
    }

    private finishClosed(reason?: Error): void {
        if (reason && !this.closeReason) {
            this.closeReason = reason;
        }
        if (this.stateValue !== 'closed') {
            if (this.stateValue !== 'closing') {
                this.transitionTo('closing');
            }
            this.transitionTo('closed');
        }
        if (!this.exitSettled) {
            this.exitSettled = true;
            this.resolveExit();
        }
        const terminalReason = this.closeReason ?? new OmpRpcStateError('OMP RPC transport closed');
        for (const listener of this.closeListeners) {
            listener(terminalReason);
        }
        this.closeListeners.clear();
    }

    private transitionTo(next: OmpRpcTransportState): void {
        const allowed: Record<OmpRpcTransportState, OmpRpcTransportState[]> = {
            starting: ['discovering', 'closing'],
            discovering: ['ready', 'closing'],
            ready: ['closing'],
            closing: ['closed'],
            closed: []
        };
        if (!allowed[this.stateValue].includes(next)) {
            throw new OmpRpcStateError(`Invalid OMP RPC transition ${this.stateValue} -> ${next}`);
        }
        this.stateValue = next;
        logger.debug(`[omp-rpc] state=${next}`);
    }

    private emitDiagnostic(message: string): void {
        logger.debug(`[omp-rpc] ${message}`);
        for (const listener of this.diagnosticListeners) {
            listener(message);
        }
    }

    private abortError(command: OmpCommandType, reason: unknown): OmpRpcRequestError {
        const detail = reason instanceof Error ? reason.message : String(reason ?? 'aborted');
        return new OmpRpcRequestError(command, `OMP RPC ${command} caller aborted: ${detail}`);
    }
}
