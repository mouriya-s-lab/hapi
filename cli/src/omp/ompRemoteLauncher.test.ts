import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import type { OmpMode, PermissionMode } from './types';
import type {
    OmpCommand,
    OmpInboundEvent,
    OmpModel,
    OmpResponseDataByCommand,
    OmpSessionState
} from './rpc/types';

type RpcHandler = (params: unknown) => unknown;
type EventListener = (event: OmpInboundEvent) => void;
type ClosedListener = (reason: Error) => void;

function model(provider: string, id: string, name: string = id): OmpModel {
    return {
        id,
        name,
        api: 'openai-completions',
        provider,
        baseUrl: 'http://localhost',
        reasoning: true,
        input: ['text'],
        contextWindow: 128_000,
        maxTokens: 16_384,
        thinking: {
            mode: 'levels',
            efforts: ['low', 'high'],
            defaultLevel: 'high'
        },
        raw: {}
    };
}

function state(currentModel: OmpModel | null): OmpSessionState {
    return {
        ...(currentModel ? { model: currentModel } : {}),
        isStreaming: false,
        isCompacting: false,
        steeringMode: 'all',
        followUpMode: 'all',
        interruptMode: 'immediate',
        sessionId: 'omp-session-1',
        autoCompactionEnabled: true,
        messageCount: 0,
        queuedMessageCount: 0,
        todoPhases: []
    };
}

const harness = vi.hoisted(() => ({
    connectArgs: [] as unknown[],
    events: [] as string[],
    prompts: [] as string[],
    requests: [] as OmpCommand[],
    eventListeners: [] as EventListener[],
    closedListeners: [] as ClosedListener[],
    close: vi.fn(async () => {}),
    connectError: null as Error | null,
    requestError: null as null | ((command: OmpCommand) => Error | null),
    autoFinishPrompt: true,
    currentModel: null as OmpModel | null,
    availableModels: [] as OmpModel[]
}));

vi.mock('./rpc/OmpRpcClient', () => ({
    OmpRpcClient: {
        connect: vi.fn(async (args: unknown) => {
            harness.connectArgs.push(args);
            if (harness.connectError) {
                throw harness.connectError;
            }
            return {
                state: 'ready',
                discovery: {
                    version: '17.0.4',
                    state: state(harness.currentModel),
                    commands: [],
                    models: harness.availableModels
                },
                request: vi.fn(async (command: OmpCommand) => {
                    harness.requests.push(command);
                    const failure = harness.requestError?.(command);
                    if (failure) {
                        throw failure;
                    }
                    switch (command.type) {
                        case 'prompt':
                            harness.prompts.push(command.message);
                            harness.events.push(`prompt:${command.message}`);
                            if (harness.autoFinishPrompt) {
                                queueMicrotask(() => {
                                    for (const listener of harness.eventListeners) {
                                        listener({ type: 'agent_end', raw: { type: 'agent_end' } });
                                    }
                                });
                            }
                            return { agentInvoked: true } satisfies OmpResponseDataByCommand['prompt'];
                        case 'set_model': {
                            const next = harness.availableModels.find((candidate) => (
                                candidate.provider === command.provider && candidate.id === command.modelId
                            ));
                            if (!next) {
                                throw new Error(`missing fake model ${command.provider}/${command.modelId}`);
                            }
                            harness.events.push(`set_model:${command.provider}/${command.modelId}`);
                            harness.currentModel = next;
                            return next;
                        }
                        case 'get_state':
                            return state(harness.currentModel);
                        case 'abort':
                            harness.events.push('abort');
                            return undefined;
                        default:
                            throw new Error(`Unexpected launcher command: ${command.type}`);
                    }
                }),
                onEvent(listener: EventListener) {
                    harness.eventListeners.push(listener);
                    return () => {};
                },
                onDiagnostic() {
                    return () => {};
                },
                onClosed(listener: ClosedListener) {
                    harness.closedListeners.push(listener);
                    return () => {};
                },
                close: harness.close
            };
        })
    }
}));

vi.mock('@/ui/ink/OmpDisplay', () => ({
    OmpDisplay: () => null
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        info: vi.fn()
    }
}));

import { ompRemoteLauncher } from './ompRemoteLauncher';

function createMode(modelId?: string): OmpMode {
    return {
        permissionMode: 'default' as PermissionMode,
        model: modelId
    };
}

function createPlanMode(): OmpMode {
    return {
        permissionMode: 'plan' as PermissionMode
    };
}

function createResetMode(): OmpMode {
    return {
        permissionMode: 'default' as PermissionMode,
        model: null
    };
}

function createSessionStub(
    items: Array<{ message: string; mode: OmpMode }>,
    options: { launchModel?: string | null; sessionId?: string | null } = {}
) {
    const queue = new MessageQueue2<OmpMode>((mode) => JSON.stringify(mode));
    items.forEach(({ message, mode }, index) => {
        if (index === 0 && items.length > 1) {
            queue.pushIsolateAndClear(message, mode);
        } else {
            queue.push(message, mode);
        }
    });
    queue.close();

    const sessionEvents: Array<{ type: string; [key: string]: unknown }> = [];
    const rpcHandlers = new Map<string, RpcHandler>();
    const client = {
        rpcHandlerManager: {
            registerHandler(method: string, handler: RpcHandler) {
                rpcHandlers.set(method, handler);
            }
        },
        sendAgentMessage(_message: unknown) {},
        sendUserMessage(_text: string) {},
        sendSessionEvent(event: { type: string; [key: string]: unknown }) {
            sessionEvents.push(event);
        }
    };

    const session = {
        path: '/tmp/hapi-omp-test',
        logPath: '/tmp/hapi-omp-test/test.log',
        client,
        queue,
        sessionId: options.sessionId ?? null,
        thinking: false,
        getModel() {
            return options.launchModel;
        },
        getPermissionMode() {
            return 'default' as const;
        },
        setModel(_model: string | null) {},
        onThinkingChange(thinking: boolean) {
            session.thinking = thinking;
        },
        onSessionFound(id: string) {
            session.sessionId = id;
        },
        sendAgentMessage(_message: unknown) {},
        sendSessionEvent(event: { type: string; [key: string]: unknown }) {
            client.sendSessionEvent(event);
        },
        sendUserMessage(_text: string) {}
    };

    return { session, sessionEvents, rpcHandlers };
}

async function waitForRequest(type: OmpCommand['type']): Promise<void> {
    await vi.waitFor(() => {
        expect(harness.requests.some((request) => request.type === type)).toBe(true);
    });
}

describe('ompRemoteLauncher RPC lifecycle', () => {
    afterEach(() => {
        harness.connectArgs = [];
        harness.events = [];
        harness.prompts = [];
        harness.requests = [];
        harness.eventListeners = [];
        harness.closedListeners = [];
        harness.close.mockReset();
        harness.close.mockResolvedValue(undefined);
        harness.connectError = null;
        harness.requestError = null;
        harness.autoFinishPrompt = true;
        harness.currentModel = model('ollama', 'launch-default', 'Launch default');
        harness.availableModels = [
            harness.currentModel,
            model('ollama', 'a', 'Model A'),
            model('ollama', 'b', 'Model B'),
            model('mlx', 'qwen3:0.6b', 'MLX Qwen3')
        ];
    });

    it('connects through native RPC with launch model and resume session', async () => {
        const { session } = createSessionStub(
            [{ message: 'first', mode: createMode() }],
            { launchModel: 'ollama/a', sessionId: 'resume-me' }
        );

        await ompRemoteLauncher(session as never);

        expect(harness.connectArgs).toEqual([expect.objectContaining({
            cwd: '/tmp/hapi-omp-test',
            model: 'ollama/a',
            resumeSessionId: 'resume-me'
        })]);
        expect(session.sessionId).toBe('omp-session-1');
        expect(harness.close).toHaveBeenCalledOnce();
    });

    it('serializes native model switching between completed turns', async () => {
        harness.currentModel = model('ollama', 'a', 'Model A');
        harness.availableModels[0] = harness.currentModel;
        const { session } = createSessionStub([
            { message: 'first', mode: createMode('ollama/a') },
            { message: 'second', mode: createMode('mlx/qwen3:0.6b') }
        ]);

        await ompRemoteLauncher(session as never);

        expect(harness.events).toEqual([
            'prompt:first',
            'set_model:mlx/qwen3:0.6b',
            'prompt:second'
        ]);
        expect(harness.requests.filter((request) => request.type === 'set_model')).toEqual([
            { type: 'set_model', provider: 'mlx', modelId: 'qwen3:0.6b' }
        ]);
    });

    it('does not switch when the requested model is already active', async () => {
        harness.currentModel = model('ollama', 'a', 'Model A');
        harness.availableModels[0] = harness.currentModel;
        const { session } = createSessionStub([
            { message: 'first', mode: createMode('ollama/a') },
            { message: 'second', mode: createMode('ollama/a') }
        ]);

        await ompRemoteLauncher(session as never);

        expect(harness.requests.some((request) => request.type === 'set_model')).toBe(false);
        expect(harness.prompts).toEqual(['first', 'second']);
    });

    it('resets to the launch-time native model', async () => {
        const { session } = createSessionStub([
            { message: 'first', mode: createMode('ollama/a') },
            { message: 'second', mode: createResetMode() }
        ]);

        await ompRemoteLauncher(session as never);

        expect(harness.requests.filter((request) => request.type === 'set_model')).toEqual([
            { type: 'set_model', provider: 'ollama', modelId: 'a' },
            { type: 'set_model', provider: 'ollama', modelId: 'launch-default' }
        ]);
    });

    it('temporarily preserves plan-mode instruction injection', async () => {
        const { session } = createSessionStub([
            { message: 'design the fix', mode: createPlanMode() }
        ]);

        await ompRemoteLauncher(session as never);

        expect(harness.prompts[0]).toContain('You are in plan mode');
        expect(harness.prompts[0]).toContain('Do not execute tools');
        expect(harness.prompts[0]).toContain('design the fix');
    });

    it('serves the native discovery model catalog through the transitional handler', async () => {
        const { session, rpcHandlers } = createSessionStub([
            { message: 'first', mode: createMode() }
        ]);
        await ompRemoteLauncher(session as never);

        const handler = rpcHandlers.get('listOpencodeModels');
        expect(handler).toBeDefined();
        await expect(handler!(undefined)).resolves.toEqual({
            success: true,
            availableModels: harness.availableModels.map((candidate) => ({
                modelId: candidate.id,
                name: candidate.name,
                reasoningEfforts: [
                    { value: 'low', name: 'low', isDefault: false },
                    { value: 'high', name: 'high', isDefault: true }
                ]
            })),
            currentModelId: 'launch-default'
        });
    });

    it('routes remote abort through the native abort command', async () => {
        harness.autoFinishPrompt = false;
        const { session, rpcHandlers } = createSessionStub([
            { message: 'wait for abort', mode: createMode() }
        ]);
        const launch = ompRemoteLauncher(session as never);
        await waitForRequest('prompt');

        const abort = rpcHandlers.get('abort');
        expect(abort).toBeDefined();
        await abort!(undefined);
        await launch;

        expect(harness.requests.some((request) => request.type === 'abort')).toBe(true);
    });

    it('propagates native RPC connection failure without an ACP fallback', async () => {
        harness.connectError = new Error('OMP RPC discovery failed');
        const { session } = createSessionStub([
            { message: 'first', mode: createMode() }
        ]);

        await expect(ompRemoteLauncher(session as never)).rejects.toThrow('OMP RPC discovery failed');
        expect(harness.connectArgs).toHaveLength(1);
    });

    it('propagates transport closure while a turn is active', async () => {
        harness.autoFinishPrompt = false;
        const { session } = createSessionStub([
            { message: 'first', mode: createMode() }
        ]);
        const launch = ompRemoteLauncher(session as never);
        await waitForRequest('prompt');

        for (const listener of harness.closedListeners) {
            listener(new Error('OMP RPC transport crashed'));
        }

        await expect(launch).rejects.toThrow('OMP RPC transport crashed');
    });

    it('propagates cleanup failure', async () => {
        harness.close.mockRejectedValueOnce(new Error('OMP RPC close failed'));
        const { session } = createSessionStub([
            { message: 'first', mode: createMode() }
        ]);

        await expect(ompRemoteLauncher(session as never)).rejects.toThrow('OMP RPC close failed');
    });
});
