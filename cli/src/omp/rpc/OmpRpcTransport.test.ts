import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
    buildOmpRpcArgs,
    OmpRpcProtocolError,
    OmpRpcRequestError,
    OmpRpcStateError,
    OmpRpcTransport,
    type OmpRpcTransportDependencies
} from './OmpRpcTransport';

type CapturedFrame = {
    type: string;
    id: string;
};

type FakeProcess = ChildProcessWithoutNullStreams & EventEmitter & {
    stdin: Writable;
    stdout: PassThrough;
    stderr: PassThrough;
};

function createFakeProcess(stdinOverride?: Writable): {
    child: FakeProcess;
    frames: CapturedFrame[];
} {
    const child = new EventEmitter() as FakeProcess;
    const stdin = stdinOverride ?? new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const frames: CapturedFrame[] = [];
    let inputBuffer = '';

    stdin.setDefaultEncoding('utf8');
    if ('on' in stdin) {
        stdin.on('data', (chunk: Buffer | string) => {
            inputBuffer += chunk.toString();
            let newline = inputBuffer.indexOf('\n');
            while (newline >= 0) {
                const line = inputBuffer.slice(0, newline);
                inputBuffer = inputBuffer.slice(newline + 1);
                if (line) {
                    frames.push(JSON.parse(line) as CapturedFrame);
                }
                newline = inputBuffer.indexOf('\n');
            }
        });
    }

    child.stdin = stdin;
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = vi.fn().mockReturnValue(true);
    Object.defineProperty(child, 'pid', { value: 4242 });
    return { child, frames };
}

function createDependencies(child: FakeProcess): {
    dependencies: Partial<OmpRpcTransportDependencies>;
    killProcess: ReturnType<typeof vi.fn>;
} {
    const killProcess = vi.fn(async () => {
        queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
        return true;
    });
    return {
        dependencies: {
            spawnProcess: vi.fn(() => child),
            killProcess
        },
        killProcess
    };
}

async function connectFake(child: FakeProcess): Promise<OmpRpcTransport> {
    const { dependencies } = createDependencies(child);
    const connecting = OmpRpcTransport.connect(
        { cwd: '/workspace' },
        { readyTimeoutMs: 1_000, dependencies }
    );
    queueMicrotask(() => child.stdout.write('{"type":"ready"}\n'));
    return connecting;
}

async function waitForFrames(frames: CapturedFrame[], count: number): Promise<void> {
    await vi.waitFor(() => expect(frames).toHaveLength(count));
}

describe('buildOmpRpcArgs', () => {
    it('pins rpc+yolo and serializes only typed runtime options', () => {
        expect(buildOmpRpcArgs({
            cwd: '/workspace',
            profile: 'work',
            provider: 'anthropic',
            model: 'claude-opus-4-7',
            resumeSessionId: 'native-session'
        })).toEqual([
            '--mode', 'rpc',
            '--yolo',
            '--profile=work',
            '--provider', 'anthropic',
            '--model', 'claude-opus-4-7',
            '--resume', 'native-session'
        ]);
    });
});

describe('OmpRpcTransport', () => {
    it('gates business commands until discovery completes', async () => {
        const { child, frames } = createFakeProcess();
        const transport = await connectFake(child);
        expect(transport.state).toBe('discovering');

        await expect(transport.request({ type: 'prompt', message: 'too early' }))
            .rejects.toBeInstanceOf(OmpRpcStateError);

        const stateRequest = transport.request({ type: 'get_state' }, { discovery: true });
        await waitForFrames(frames, 1);
        child.stdout.write(`${JSON.stringify({
            type: 'response',
            id: frames[0].id,
            command: 'get_state',
            success: true,
            data: {}
        })}\n`);
        await expect(stateRequest).resolves.toMatchObject({ command: 'get_state' });

        transport.markReady();
        expect(transport.state).toBe('ready');
        await transport.close();
    });

    it('matches concurrent responses by id and command while dispatching interleaved events', async () => {
        const { child, frames } = createFakeProcess();
        const transport = await connectFake(child);
        const events: string[] = [];
        transport.onEvent((event) => events.push(event.type));

        const stateRequest = transport.request({ type: 'get_state' }, { discovery: true });
        const modelsRequest = transport.request({ type: 'get_available_models' }, { discovery: true });
        await waitForFrames(frames, 2);

        child.stdout.write('{"type":"turn_start"}\n');
        child.stdout.write(`${JSON.stringify({
            type: 'response',
            id: frames[1].id,
            command: 'get_available_models',
            success: true,
            data: { models: [] }
        })}\n`);
        child.stdout.write(`${JSON.stringify({
            type: 'response',
            id: frames[0].id,
            command: 'get_state',
            success: true,
            data: { sessionId: 's1' }
        })}\n`);

        await expect(modelsRequest).resolves.toMatchObject({ command: 'get_available_models' });
        await expect(stateRequest).resolves.toMatchObject({ command: 'get_state' });
        expect(events).toEqual(['turn_start']);
        await transport.close();
    });

    it('buffers split stdout lines', async () => {
        const { child, frames } = createFakeProcess();
        const transport = await connectFake(child);
        const request = transport.request({ type: 'get_available_commands' }, { discovery: true });
        await waitForFrames(frames, 1);
        const response = `${JSON.stringify({
            type: 'response',
            id: frames[0].id,
            command: 'get_available_commands',
            success: true,
            data: { commands: [] }
        })}\n`;

        child.stdout.write(response.slice(0, 9));
        child.stdout.write(response.slice(9));
        await expect(request).resolves.toMatchObject({ success: true });
        await transport.close();
    });

    it('treats malformed stdout as a fatal protocol error and rejects pending requests', async () => {
        const { child } = createFakeProcess();
        const { dependencies, killProcess } = createDependencies(child);
        const connecting = OmpRpcTransport.connect(
            { cwd: '/workspace' },
            { readyTimeoutMs: 1_000, dependencies }
        );
        queueMicrotask(() => child.stdout.write('{"type":"ready"}\n'));
        const transport = await connecting;
        const pending = transport.request({ type: 'get_state' }, { discovery: true });

        child.stdout.write('not-json\n');
        await expect(pending).rejects.toBeInstanceOf(OmpRpcProtocolError);
        await vi.waitFor(() => expect(transport.state).toBe('closed'));
        expect(killProcess).toHaveBeenCalledOnce();
    });

    it('rejects a mismatched response command and closes the transport', async () => {
        const { child, frames } = createFakeProcess();
        const transport = await connectFake(child);
        const pending = transport.request({ type: 'get_state' }, { discovery: true });
        await waitForFrames(frames, 1);

        child.stdout.write(`${JSON.stringify({
            type: 'response',
            id: frames[0].id,
            command: 'get_available_models',
            success: true,
            data: { models: [] }
        })}\n`);

        await expect(pending).rejects.toThrow(/command mismatch/);
        await vi.waitFor(() => expect(transport.state).toBe('closed'));
    });

    it('waits for stdin drain before completing a backpressured write', async () => {
        const stdin = new PassThrough({ highWaterMark: 1 });
        const { child, frames } = createFakeProcess(stdin);
        const transport = await connectFake(child);
        const request = transport.request({ type: 'get_state' }, { discovery: true });
        await waitForFrames(frames, 1);

        child.stdout.write(`${JSON.stringify({
            type: 'response',
            id: frames[0].id,
            command: 'get_state',
            success: true,
            data: {}
        })}\n`);
        await expect(request).resolves.toMatchObject({ command: 'get_state' });
        await transport.close();
    });

    it('rejects every pending request when stdin fails', async () => {
        const stdin = new Writable({
            write(_chunk, _encoding, callback) {
                callback(new Error('EPIPE'));
            }
        });
        const { child } = createFakeProcess(stdin);
        const transport = await connectFake(child);

        const first = transport.request({ type: 'get_state' }, { discovery: true });
        const second = transport.request({ type: 'get_available_models' }, { discovery: true });
        const outcomes = await Promise.allSettled([first, second]);
        expect(outcomes).toHaveLength(2);
        for (const outcome of outcomes) {
            expect(outcome.status).toBe('rejected');
            if (outcome.status === 'rejected') {
                expect(outcome.reason).toBeInstanceOf(OmpRpcStateError);
                expect((outcome.reason as Error).message).toContain('stdin failed');
            }
        }
        await vi.waitFor(() => expect(transport.state).toBe('closed'));
    });

    it('keeps caller cancellation separate from the OMP abort command', async () => {
        const { child, frames } = createFakeProcess();
        const transport = await connectFake(child);
        const controller = new AbortController();
        const pending = transport.request(
            { type: 'get_state' },
            { discovery: true, signal: controller.signal }
        );
        await waitForFrames(frames, 1);
        controller.abort(new Error('caller stopped waiting'));

        await expect(pending).rejects.toThrow(/caller stopped waiting/);
        expect(transport.state).toBe('discovering');
        await transport.close();
    });

    it('times out one request without corrupting the transport state', async () => {
        const { child } = createFakeProcess();
        const transport = await connectFake(child);

        await expect(transport.request(
            { type: 'get_state' },
            { discovery: true, timeoutMs: 10 }
        )).rejects.toBeInstanceOf(OmpRpcRequestError);
        expect(transport.state).toBe('discovering');
        await transport.close();
    });

    it('keeps stderr as diagnostics instead of parsing it as protocol', async () => {
        const { child, frames } = createFakeProcess();
        const transport = await connectFake(child);
        child.stderr.write('not-json and not a session message\n');

        const pending = transport.request({ type: 'get_state' }, { discovery: true });
        await waitForFrames(frames, 1);
        child.stdout.write(`${JSON.stringify({
            type: 'response',
            id: frames[0].id,
            command: 'get_state',
            success: true,
            data: {}
        })}\n`);

        await expect(pending).resolves.toMatchObject({ command: 'get_state' });
        expect(transport.stderrText).toContain('not-json and not a session message');
        expect(transport.state).toBe('discovering');
        await transport.close();
    });

    it('rejects pending work with stderr context when the process exits early', async () => {
        const { child } = createFakeProcess();
        const transport = await connectFake(child);
        const pending = transport.request({ type: 'get_state' }, { discovery: true });
        child.stderr.write('native crash detail\n');
        child.emit('close', 9, null);

        await expect(pending).rejects.toThrow('native crash detail');
        expect(transport.state).toBe('closed');
    });

    it('makes close idempotent and escalates only once', async () => {
        const { child } = createFakeProcess();
        const { dependencies, killProcess } = createDependencies(child);
        const connecting = OmpRpcTransport.connect(
            { cwd: '/workspace' },
            { readyTimeoutMs: 1_000, dependencies }
        );
        queueMicrotask(() => child.stdout.write('{"type":"ready"}\n'));
        const transport = await connecting;
        const reason = new Error('test cleanup');

        const first = transport.close(reason, 0);
        const second = transport.close(reason, 0);
        expect(second).toBe(first);
        await Promise.all([first, second]);

        expect(transport.state).toBe('closed');
        expect(killProcess).toHaveBeenCalledOnce();
    });

    it('fails startup when the ready frame misses its deadline', async () => {
        const { child } = createFakeProcess();
        const { dependencies, killProcess } = createDependencies(child);

        await expect(OmpRpcTransport.connect(
            { cwd: '/workspace' },
            { readyTimeoutMs: 10, dependencies }
        )).rejects.toThrow('Timed out waiting 10ms');
        expect(killProcess).toHaveBeenCalledOnce();
    });
});
