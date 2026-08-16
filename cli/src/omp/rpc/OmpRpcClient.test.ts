import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
    assertSupportedOmpVersion,
    OmpRpcClient,
    parseOmpVersion
} from './OmpRpcClient';
import type { OmpRpcTransportDependencies } from './OmpRpcTransport';

type FakeProcess = ChildProcessWithoutNullStreams & EventEmitter;
type RpcFrame = {
    id: string;
    type: string;
};

const MODEL = {
    id: 'glm-5.2',
    name: 'GLM 5.2',
    api: 'openai-completions',
    provider: 'zai',
    baseUrl: 'https://api.example.test',
    reasoning: true,
    input: ['text'],
    contextWindow: 128_000,
    maxTokens: 16_384
};

const STATE = {
    model: MODEL,
    thinkingLevel: 'high',
    isStreaming: false,
    isCompacting: false,
    steeringMode: 'all',
    followUpMode: 'all',
    interruptMode: 'immediate',
    sessionFile: '/home/user/.omp/sessions/session.jsonl',
    sessionId: 'native-session-id',
    autoCompactionEnabled: true,
    messageCount: 3,
    queuedMessageCount: 0,
    todoPhases: []
};

function createRpcProcess(
    responseFor: (frame: RpcFrame) => { success: true; data?: unknown } | { success: false; error: string } | null
): {
    child: FakeProcess;
    frames: RpcFrame[];
    dependencies: Partial<OmpRpcTransportDependencies>;
    killProcess: ReturnType<typeof vi.fn>;
} {
    const child = new EventEmitter() as FakeProcess;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const frames: RpcFrame[] = [];
    let input = '';

    stdin.setDefaultEncoding('utf8');
    stdin.on('data', (chunk: Buffer | string) => {
        input += chunk.toString();
        let newline = input.indexOf('\n');
        while (newline >= 0) {
            const line = input.slice(0, newline);
            input = input.slice(newline + 1);
            if (line) {
                const frame = JSON.parse(line) as RpcFrame;
                frames.push(frame);
                const response = responseFor(frame);
                if (response) {
                    queueMicrotask(() => stdout.write(`${JSON.stringify({
                        type: 'response',
                        id: frame.id,
                        command: frame.type,
                        ...response
                    })}\n`));
                }
            }
            newline = input.indexOf('\n');
        }
    });
    stdin.on('finish', () => queueMicrotask(() => child.emit('close', 0, null)));

    child.stdin = stdin;
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = vi.fn().mockReturnValue(true);
    Object.defineProperty(child, 'pid', { value: 4343 });

    const killProcess = vi.fn(async () => {
        queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
        return true;
    });
    const dependencies = {
        spawnProcess: vi.fn(() => {
            queueMicrotask(() => stdout.write('{"type":"ready"}\n'));
            return child;
        }),
        killProcess
    };
    return { child, frames, dependencies, killProcess };
}

function successfulDiscovery(frame: RpcFrame): { success: true; data: unknown } {
    switch (frame.type) {
        case 'get_state':
            return { success: true, data: STATE };
        case 'get_available_commands':
            return {
                success: true,
                data: { commands: [{ name: 'help', source: 'built-in' }] }
            };
        case 'get_available_models':
            return { success: true, data: { models: [MODEL] } };
        default:
            throw new Error(`Unexpected command ${frame.type}`);
    }
}

describe('OMP RPC version gate', () => {
    it('parses native omp version output', () => {
        expect(parseOmpVersion('omp/17.0.4\n')).toEqual({
            raw: 'omp/17.0.4',
            major: 17,
            minor: 0,
            patch: 4
        });
        expect(parseOmpVersion('18.2.1')).toMatchObject({ major: 18, minor: 2, patch: 1 });
    });

    it('rejects versions older than the RPC contract minimum', () => {
        expect(() => assertSupportedOmpVersion(parseOmpVersion('17.0.3')))
            .toThrow('requires OMP 17.0.4 or newer');
        expect(() => assertSupportedOmpVersion(parseOmpVersion('17.0.4'))).not.toThrow();
        expect(() => assertSupportedOmpVersion(parseOmpVersion('18.0.0'))).not.toThrow();
    });
});

describe('OmpRpcClient discovery', () => {
    it('discovers state, commands, and models before exposing a ready client', async () => {
        const fake = createRpcProcess(successfulDiscovery);
        const client = await OmpRpcClient.connect(
            { cwd: '/workspace' },
            {
                probeVersion: async () => parseOmpVersion('omp/17.0.4'),
                transportDependencies: fake.dependencies
            }
        );

        expect(client.state).toBe('ready');
        expect(fake.frames.map((frame) => frame.type).sort()).toEqual([
            'get_available_commands',
            'get_available_models',
            'get_state'
        ]);
        expect(client.discovery).toMatchObject({
            version: '17.0.4',
            state: { sessionId: 'native-session-id' },
            commands: [{ name: 'help' }],
            models: [{ provider: 'zai', id: 'glm-5.2' }]
        });
        expect(fake.dependencies.spawnProcess).toHaveBeenCalledOnce();
        expect(fake.dependencies.spawnProcess).toHaveBeenCalledWith(
            'omp',
            ['--mode', 'rpc', '--yolo'],
            expect.objectContaining({ cwd: '/workspace' })
        );

        await client.close();
        expect(client.state).toBe('closed');
    });

    it('forwards uncorrelated host control frames through the ready client', async () => {
        const fake = createRpcProcess((frame) => {
            if (frame.type === 'host_tool_result') return null;
            return successfulDiscovery(frame);
        });
        const client = await OmpRpcClient.connect(
            { cwd: '/workspace' },
            {
                probeVersion: async () => parseOmpVersion('omp/17.0.4'),
                transportDependencies: fake.dependencies
            }
        );

        await client.sendControlFrame({
            type: 'host_tool_result',
            id: 'host-call-1',
            result: { content: [{ type: 'text', text: 'done' }] }
        });
        await vi.waitFor(() => {
            expect(fake.frames.some((frame) => frame.type === 'host_tool_result')).toBe(true);
        });
        expect(fake.frames.find((frame) => frame.type === 'host_tool_result')).toMatchObject({
            id: 'host-call-1',
            result: { content: [{ type: 'text', text: 'done' }] }
        });
        await client.close();
    });

    it('closes and fails when any required discovery command fails', async () => {
        const fake = createRpcProcess((frame) => {
            if (frame.type === 'get_available_models') {
                return { success: false, error: 'models unavailable' };
            }
            return successfulDiscovery(frame);
        });

        await expect(OmpRpcClient.connect(
            { cwd: '/workspace' },
            {
                probeVersion: async () => parseOmpVersion('17.0.4'),
                transportDependencies: fake.dependencies
            }
        )).rejects.toThrow('models unavailable');

        expect(fake.dependencies.spawnProcess).toHaveBeenCalledOnce();
        expect(fake.killProcess).toHaveBeenCalledOnce();
    });

    it('closes and fails on a discovery schema violation', async () => {
        const fake = createRpcProcess((frame) => {
            if (frame.type === 'get_state') {
                return { success: true, data: { sessionId: 'missing-required-state' } };
            }
            return successfulDiscovery(frame);
        });

        await expect(OmpRpcClient.connect(
            { cwd: '/workspace' },
            {
                probeVersion: async () => parseOmpVersion('17.0.4'),
                transportDependencies: fake.dependencies
            }
        )).rejects.toThrow();
        expect(fake.dependencies.spawnProcess).toHaveBeenCalledOnce();
    });
});
