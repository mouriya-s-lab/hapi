import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OmpInputQueue } from './OmpInputQueue';
import type { OmpMode, PermissionMode } from './types';
import type {
    OmpCommand,
    OmpInboundEvent,
    OmpModel,
    OmpResponseDataByCommand,
    OmpSessionState
} from './rpc/types';
import type { AttachmentMetadata, OmpInputMode } from '@hapi/protocol/types';

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
        ...(harness.thinkingLevel ? { thinkingLevel: harness.thinkingLevel } : {}),
        isStreaming: harness.stateStreaming,
        isCompacting: false,
        steeringMode: 'all',
        followUpMode: 'all',
        interruptMode: 'immediate',
        sessionId: harness.sessionId,
        sessionFile: `/sessions/${harness.sessionId}.jsonl`,
        ...(harness.sessionName ? { sessionName: harness.sessionName } : {}),
        autoCompactionEnabled: true,
        messageCount: 0,
        queuedMessageCount: harness.queuedMessageCount,
        todoPhases: [],
        contextUsage: harness.contextUsage
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
    promptResponse: { agentInvoked: true } as OmpResponseDataByCommand['prompt'],
    stateStreaming: false,
    queuedMessageCount: 0,
    currentModel: null as OmpModel | null,
    availableModels: [] as OmpModel[],
    thinkingLevel: 'high' as import('./rpc/types').OmpThinkingLevel | undefined,
    configuredThinking: 'high' as import('./rpc/types').OmpConfiguredThinkingLevel | undefined,
    contextUsage: { tokens: 1_024, contextWindow: 128_000, percent: 0.8 },
    sessionId: 'omp-session-1',
    sessionName: 'OMP session one' as string | null,
    resumePaths: {} as Record<string, string>
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
                            return harness.promptResponse;
                        case 'steer':
                            harness.events.push(`steer:${command.message}`);
                            return undefined;
                        case 'follow_up':
                            harness.events.push(`follow_up:${command.message}`);
                            return undefined;
                        case 'abort_and_prompt':
                            harness.events.push(`abort_and_prompt:${command.message}`);
                            return undefined;
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
                        case 'cycle_model': {
                            const currentIndex = harness.currentModel
                                ? harness.availableModels.findIndex((candidate) => (
                                    candidate.provider === harness.currentModel?.provider
                                    && candidate.id === harness.currentModel.id
                                ))
                                : -1;
                            const next = harness.availableModels[(currentIndex + 1) % harness.availableModels.length];
                            if (!next) return null;
                            harness.currentModel = next;
                            harness.events.push(`cycle_model:${next.provider}/${next.id}`);
                            return { model: next, thinkingLevel: harness.thinkingLevel, isScoped: false };
                        }
                        case 'get_available_models':
                            return { models: harness.availableModels };
                        case 'set_thinking_level':
                            harness.thinkingLevel = command.level;
                            harness.configuredThinking = command.level;
                            harness.events.push(`set_thinking_level:${command.level}`);
                            return undefined;
                        case 'cycle_thinking_level': {
                            const levels = ['off', 'auto', 'low', 'high'] as const;
                            const index = harness.configuredThinking
                                ? levels.indexOf(harness.configuredThinking as typeof levels[number])
                                : -1;
                            const level = levels[(index + 1) % levels.length];
                            harness.configuredThinking = level;
                            harness.thinkingLevel = level === 'auto' ? 'medium' : level;
                            harness.events.push(`cycle_thinking_level:${level}`);
                            return { level };
                        }
                        case 'get_state':
                            return state(harness.currentModel);
                        case 'new_session':
                            harness.sessionId = 'omp-session-2';
                            harness.sessionName = null;
                            return { cancelled: false } satisfies OmpResponseDataByCommand['new_session'];
                        case 'set_session_name':
                            harness.sessionName = command.name;
                            return undefined;
                        case 'switch_session':
                            harness.sessionId = 'omp-session-resumed';
                            harness.sessionName = 'Resumed OMP session';
                            return { cancelled: false } satisfies OmpResponseDataByCommand['switch_session'];
                        case 'handoff':
                            harness.sessionId = 'omp-session-handoff';
                            harness.sessionName = null;
                            return { savedPath: '/sessions/handoff.md' } satisfies OmpResponseDataByCommand['handoff'];
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

vi.mock('./utils/ompSessionScanner', () => ({
    resolveOmpSessionPath: vi.fn(async (sessionArg: string) => harness.resumePaths[sessionArg] ?? null)
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

function createResetMode(): OmpMode {
    return {
        permissionMode: 'default' as PermissionMode,
        model: null
    };
}

function createSessionStub(
    items: Array<{
        message: string;
        mode: OmpMode;
        inputMode?: OmpInputMode;
        attachments?: AttachmentMetadata[];
        localId?: string;
    }>,
    options: {
        launchModel?: string | null;
        launchEffort?: import('./rpc/types').OmpConfiguredThinkingLevel;
        sessionId?: string | null;
        closeQueue?: boolean;
    } = {}
) {
    const queue = new OmpInputQueue((mode) => JSON.stringify(mode));
    items.forEach(({ message, mode, inputMode, attachments, localId }) => {
        queue.push({
            text: message,
            mode,
            inputMode: inputMode ?? 'prompt',
            attachments,
            localId
        });
    });
    if (options.closeQueue !== false) {
        queue.close();
    }

    const sessionEvents: Array<{ type: string; [key: string]: unknown }> = [];
    const snapshots: Array<{ id: string; file: string; name?: string }> = [];
    const consumedLocalIds: string[][] = [];
    const agentMessages: unknown[] = [];
    const thinkingStates: import('@hapi/protocol/omp').OmpThinkingState[] = [];
    const rpcHandlers = new Map<string, RpcHandler>();
    let runtimeConfigApplier: ((config: import('./session').OmpRuntimeConfigRequest) => Promise<import('./session').OmpRuntimeConfigApplied>) | null = null;
    const client = {
        rpcHandlerManager: {
            registerHandler(method: string, handler: RpcHandler) {
                rpcHandlers.set(method, handler);
            }
        },
        sendAgentMessage(message: unknown) {
            agentMessages.push(message);
        },
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
        getEffort() {
            return options.launchEffort;
        },
        getPermissionMode() {
            return 'default' as const;
        },
        setModel(_model: string | null) {},
        setEffort(_effort: import('./rpc/types').OmpConfiguredThinkingLevel) {},
        setRuntimeConfigApplier(applier: typeof runtimeConfigApplier) {
            runtimeConfigApplier = applier;
        },
        async applyRuntimeConfig(config: import('./session').OmpRuntimeConfigRequest) {
            if (!runtimeConfigApplier) throw new Error('runtime config applier unavailable');
            return await runtimeConfigApplier(config);
        },
        updateThinkingState(state: import('@hapi/protocol/omp').OmpThinkingState) {
            thinkingStates.push(state);
        },
        onThinkingChange(thinking: boolean) {
            session.thinking = thinking;
        },
        applyNativeSessionSnapshot(snapshot: { id: string; file: string; name?: string }) {
            snapshots.push(snapshot);
            session.sessionId = snapshot.id;
        },
        sendAgentMessage(message: unknown) {
            agentMessages.push(message);
        },
        sendSessionEvent(event: { type: string; [key: string]: unknown }) {
            client.sendSessionEvent(event);
        },
        sendUserMessage(_text: string) {}
    };
    queue.onBatchConsumed = (localIds) => consumedLocalIds.push(localIds);

    return {
        session,
        sessionEvents,
        rpcHandlers,
        snapshots,
        consumedLocalIds,
        agentMessages,
        thinkingStates,
        getRuntimeConfigApplier: () => runtimeConfigApplier
    };
}

async function waitForRequest(type: OmpCommand['type']): Promise<void> {
    await vi.waitFor(() => {
        expect(harness.requests.some((request) => request.type === type)).toBe(true);
    });
}

async function waitForRequestCount(type: OmpCommand['type'], count: number): Promise<void> {
    await vi.waitFor(() => {
        expect(harness.requests.filter((request) => request.type === type)).toHaveLength(count);
    });
}

function emitEvent(type: string, raw: Record<string, unknown> = {}): void {
    for (const listener of harness.eventListeners) {
        listener({ type, raw: { type, ...raw } });
    }
}

const createdDirectories: string[] = [];

describe('ompRemoteLauncher RPC lifecycle', () => {
    afterEach(async () => {
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
        harness.promptResponse = { agentInvoked: true };
        harness.stateStreaming = false;
        harness.queuedMessageCount = 0;
        harness.currentModel = model('ollama', 'launch-default', 'Launch default');
        harness.availableModels = [
            harness.currentModel,
            model('ollama', 'a', 'Model A'),
            model('ollama', 'b', 'Model B'),
            model('mlx', 'qwen3:0.6b', 'MLX Qwen3')
        ];
        harness.sessionId = 'omp-session-1';
        harness.sessionName = 'OMP session one';
        harness.thinkingLevel = 'high';
        harness.configuredThinking = 'high';
        harness.contextUsage = { tokens: 1_024, contextWindow: 128_000, percent: 0.8 };
        harness.resumePaths = {};
        await Promise.all(createdDirectories.splice(0).map((directory) => (
            rm(directory, { recursive: true, force: true })
        )));
    });

    it('connects through native RPC with launch model and resume session', async () => {
        const { session, snapshots } = createSessionStub(
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
        expect(snapshots[0]).toEqual({
            id: 'omp-session-1',
            file: '/sessions/omp-session-1.jsonl',
            name: 'OMP session one'
        });
        expect(harness.close).toHaveBeenCalledOnce();
    });

    it('reconciles native session_info_update events through get_state', async () => {
        harness.autoFinishPrompt = false;
        const { session, snapshots } = createSessionStub([
            { message: 'wait for rename', mode: createMode() }
        ]);
        const launch = ompRemoteLauncher(session as never);
        await waitForRequest('prompt');

        for (const listener of harness.eventListeners) {
            listener({ type: 'session_info_update', raw: { type: 'session_info_update' } });
        }
        await vi.waitFor(() => {
            expect(harness.requests.filter((request) => request.type === 'get_state').length).toBeGreaterThan(0);
            expect(snapshots.length).toBeGreaterThan(1);
        });
        for (const listener of harness.eventListeners) {
            listener({ type: 'agent_end', raw: { type: 'agent_end' } });
        }
        await launch;
    });

    it('reconciles state after every prompt without depending on session_info_update', async () => {
        const { session, snapshots } = createSessionStub([
            { message: 'ordinary turn', mode: createMode() }
        ]);

        await ompRemoteLauncher(session as never);

        expect(harness.requests.map((request) => request.type)).toEqual([
            'prompt',
            'get_state',
            'get_state'
        ]);
        expect(snapshots).toHaveLength(2);
    });

    it('routes clear and rename through native mutations with immediate snapshots', async () => {
        const { session, snapshots } = createSessionStub([
            { message: '/rename Renamed session', mode: createMode() },
            { message: '/clear', mode: createMode() }
        ]);

        await ompRemoteLauncher(session as never);

        expect(harness.requests.filter((request) => (
            request.type === 'set_session_name' || request.type === 'new_session'
        ))).toEqual([
            { type: 'set_session_name', name: 'Renamed session' },
            { type: 'new_session' }
        ]);
        expect(harness.requests.some((request) => request.type === 'prompt')).toBe(false);
        expect(snapshots).toContainEqual({
            id: 'omp-session-1',
            file: '/sessions/omp-session-1.jsonl',
            name: 'Renamed session'
        });
        expect(snapshots).toContainEqual({
            id: 'omp-session-2',
            file: '/sessions/omp-session-2.jsonl'
        });
    });

    it('routes handoff and resume through native mutations with immediate snapshots', async () => {
        harness.resumePaths['native-prefix'] = '/sessions/native-target.jsonl';
        const { session, snapshots } = createSessionStub([
            { message: '/handoff focus on verification', mode: createMode() },
            { message: '/resume native-prefix', mode: createMode() }
        ]);

        await ompRemoteLauncher(session as never);

        expect(harness.requests.filter((request) => (
            request.type === 'handoff' || request.type === 'switch_session'
        ))).toEqual([
            { type: 'handoff', customInstructions: 'focus on verification' },
            { type: 'switch_session', sessionPath: '/sessions/native-target.jsonl' }
        ]);
        expect(harness.requests.some((request) => request.type === 'prompt')).toBe(false);
        expect(snapshots).toContainEqual({
            id: 'omp-session-handoff',
            file: '/sessions/omp-session-handoff.jsonl'
        });
        expect(snapshots).toContainEqual({
            id: 'omp-session-resumed',
            file: '/sessions/omp-session-resumed.jsonl',
            name: 'Resumed OMP session'
        });
    });

    it('reports remote resume picker and unknown session requests without prompting the model', async () => {
        const { session, sessionEvents } = createSessionStub([
            { message: '/resume', mode: createMode() },
            { message: '/resume missing-id', mode: createMode() }
        ]);

        await ompRemoteLauncher(session as never);

        expect(harness.requests.some((request) => (
            request.type === 'prompt' || request.type === 'switch_session'
        ))).toBe(false);
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'Oh My Pi RPC session mutation failed: Use /resume <session id> when controlling OMP remotely'
        });
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'Oh My Pi RPC session mutation failed: Session "missing-id" not found'
        });
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

    it('holds a different config hash until the active native turn finishes', async () => {
        harness.autoFinishPrompt = false;
        harness.currentModel = model('ollama', 'a', 'Model A');
        harness.availableModels[0] = harness.currentModel;
        const { session } = createSessionStub([
            { message: 'first', mode: createMode('ollama/a') },
            { message: 'second', mode: createMode('mlx/qwen3:0.6b') }
        ], { closeQueue: false });
        const launch = ompRemoteLauncher(session as never);
        await waitForRequest('prompt');
        emitEvent('agent_start');
        await vi.waitFor(() => expect(session.queue.heldSize()).toBe(1));

        expect(harness.prompts).toEqual(['first']);
        expect(harness.requests.some((request) => request.type === 'set_model')).toBe(false);
        emitEvent('agent_end');
        await waitForRequestCount('prompt', 2);
        session.queue.close();
        emitEvent('agent_start');
        emitEvent('agent_end');
        await launch;

        expect(harness.events).toEqual([
            'prompt:first',
            'set_model:mlx/qwen3:0.6b',
            'prompt:second'
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

    it('forwards prompts without synthetic permission instructions', async () => {
        const { session } = createSessionStub([
            { message: 'design the fix', mode: createMode() }
        ]);

        await ompRemoteLauncher(session as never);

        expect(harness.prompts).toEqual(['design the fix']);
    });

    it('serves a provider-qualified native OMP model catalog', async () => {
        const { session, rpcHandlers } = createSessionStub([
            { message: 'first', mode: createMode() }
        ], { closeQueue: false });
        const launch = ompRemoteLauncher(session as never);
        await waitForRequest('prompt');
        await vi.waitFor(() => expect(rpcHandlers.has('listOmpModels')).toBe(true));

        const handler = rpcHandlers.get('listOmpModels');
        expect(handler).toBeDefined();
        await expect(handler!(undefined)).resolves.toEqual({
            success: true,
            availableModels: harness.availableModels.map((candidate) => ({
                provider: candidate.provider,
                modelId: candidate.id,
                name: candidate.name,
                reasoning: true,
                contextWindow: 128_000,
                maxTokens: 16_384,
                thinkingLevels: ['low', 'high']
            })),
            currentModel: { provider: 'ollama', modelId: 'launch-default' }
        });
        expect(rpcHandlers.has('listOpencodeModels')).toBe(false);
        session.queue.close();
        await launch;
    });

    it('cycles the native OMP model and confirms it through get_state', async () => {
        const { session, rpcHandlers } = createSessionStub([], { closeQueue: false });
        const launch = ompRemoteLauncher(session as never);
        await vi.waitFor(() => expect(rpcHandlers.has('cycleOmpModel')).toBe(true));

        await expect(rpcHandlers.get('cycleOmpModel')!(undefined)).resolves.toEqual({
            success: true,
            currentModel: { provider: 'ollama', modelId: 'a' }
        });
        expect(harness.requests.some((request) => request.type === 'cycle_model')).toBe(true);
        expect(harness.requests.some((request) => request.type === 'get_state')).toBe(true);

        session.queue.close();
        await launch;
    });

    it('applies low, high, and auto thinking only after native state confirmation', async () => {
        const { session, thinkingStates, getRuntimeConfigApplier } = createSessionStub([], { closeQueue: false });
        const launch = ompRemoteLauncher(session as never);
        await vi.waitFor(() => expect(getRuntimeConfigApplier()).not.toBeNull());
        const apply = getRuntimeConfigApplier()!;

        await expect(apply({ effort: 'low' })).resolves.toEqual({ effort: 'low' });
        await expect(apply({ effort: 'high' })).resolves.toEqual({ effort: 'high' });
        await expect(apply({ effort: 'auto' })).resolves.toEqual({ effort: 'auto' });

        expect(harness.requests.filter((request) => request.type === 'set_thinking_level')).toEqual([
            { type: 'set_thinking_level', level: 'low' },
            { type: 'set_thinking_level', level: 'high' }
        ]);
        expect(harness.requests.filter((request) => request.type === 'cycle_thinking_level')).toHaveLength(2);
        expect(thinkingStates.at(-1)).toEqual({
            thinkingLevel: 'medium',
            configured: 'auto',
            resolved: null
        });

        emitEvent('thinking_level_changed', {
            thinkingLevel: 'low',
            configured: 'auto',
            resolved: 'low'
        });
        expect(thinkingStates.at(-1)).toEqual({
            thinkingLevel: 'low',
            configured: 'auto',
            resolved: 'low'
        });

        session.queue.close();
        await launch;
    });

    it('restores persisted auto thinking on RPC reconnect despite get_state exposing only effective thinking', async () => {
        harness.thinkingLevel = 'high';
        harness.configuredThinking = 'high';
        const { session, thinkingStates } = createSessionStub([], {
            closeQueue: false,
            launchEffort: 'auto'
        });
        const launch = ompRemoteLauncher(session as never);

        await vi.waitFor(() => {
            expect(harness.configuredThinking).toBe('auto');
            expect(thinkingStates.at(-1)?.configured).toBe('auto');
        });
        expect(harness.requests.some((request) => request.type === 'cycle_thinking_level')).toBe(true);

        session.queue.close();
        await launch;
    });

    it('forwards OMP model, tokens, authoritative context, and cost', async () => {
        harness.contextUsage = { tokens: 4_096, contextWindow: 128_000, percent: 3.2 };
        const { session, agentMessages } = createSessionStub([], { closeQueue: false });
        const launch = ompRemoteLauncher(session as never);
        await vi.waitFor(() => expect(harness.eventListeners.length).toBeGreaterThan(0));

        emitEvent('message_end', {
            message: {
                role: 'assistant',
                content: [
                    { type: 'thinking', thinking: 'native reasoning' },
                    { type: 'text', text: 'native answer' }
                ],
                provider: 'ollama',
                model: 'launch-default',
                usage: {
                    input: 120,
                    output: 30,
                    cacheRead: 10,
                    cacheWrite: 0,
                    totalTokens: 160,
                    reasoningTokens: 5,
                    cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0, total: 0.031 }
                },
                stopReason: 'stop'
            }
        });

        await vi.waitFor(() => expect(agentMessages).toContainEqual({
            type: 'token_count',
            info: {
                total: {
                    inputTokens: 120,
                    outputTokens: 30,
                    totalTokens: 160,
                    thoughtTokens: 5,
                    cachedInputTokens: 10
                },
                contextTokens: 4_096,
                modelContextWindow: 128_000,
                costUsd: 0.031
            }
        }));
        expect(agentMessages).toContainEqual({
            type: 'reasoning',
            message: 'native reasoning',
            id: expect.any(String)
        });
        expect(agentMessages).toContainEqual({
            type: 'message',
            message: 'native answer',
            model: 'ollama/launch-default',
            usage: {
                total: {
                    inputTokens: 120,
                    outputTokens: 30,
                    totalTokens: 160,
                    thoughtTokens: 5,
                    cachedInputTokens: 10
                },
                costUsd: 0.031
            }
        });

        session.queue.close();
        await launch;
    });

    it('does not translate Claude-only prompt/tool fields into OMP RPC commands', async () => {
        const mode = {
            ...createMode(),
            fallbackModel: 'fallback',
            customSystemPrompt: 'custom',
            appendSystemPrompt: 'append',
            allowedTools: ['Read'],
            disallowedTools: ['Bash']
        } as OmpMode;
        const { session } = createSessionStub([{ message: 'plain turn', mode }]);

        await ompRemoteLauncher(session as never);

        expect(harness.requests.some((request) => (
            request.type === 'set_host_tools'
            || ('type' in request && ![
                'prompt', 'get_state'
            ].includes(request.type))
        ))).toBe(false);
        expect(harness.prompts).toEqual(['plain turn']);
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

    it('dispatches streaming prompt, steer, follow-up, and abort-and-prompt as distinct native commands', async () => {
        harness.autoFinishPrompt = false;
        const { session, consumedLocalIds, sessionEvents } = createSessionStub([
            { message: 'long turn', mode: createMode(), localId: 'initial' }
        ], { closeQueue: false });
        const launch = ompRemoteLauncher(session as never);
        await waitForRequest('prompt');
        emitEvent('agent_start');

        session.queue.push({
            text: 'correct direction',
            mode: createMode(),
            inputMode: 'steer',
            localId: 'steer'
        });
        await waitForRequest('steer');
        session.queue.push({
            text: 'next task',
            mode: createMode(),
            inputMode: 'follow_up',
            localId: 'follow-up-one'
        });
        session.queue.push({
            text: 'cancel me',
            mode: createMode(),
            inputMode: 'follow_up',
            localId: 'follow-up-two'
        });
        await waitForRequest('follow_up');
        await vi.waitFor(() => expect(session.queue.heldSize()).toBe(1));
        expect(sessionEvents.some((event) => event.type === 'ready')).toBe(false);
        expect(session.queue.cancelByLocalId('follow-up-two')).toBe(true);

        session.queue.push({
            text: 'replace the turn',
            mode: createMode(),
            inputMode: 'abort_and_prompt',
            localId: 'replace'
        });
        await Promise.resolve();
        expect(harness.requests.some((request) => request.type === 'abort_and_prompt')).toBe(false);
        emitEvent('message_end', {
            message: { role: 'user', content: [{ type: 'text', text: 'next task' }] }
        });
        await waitForRequest('abort_and_prompt');
        session.queue.close();
        emitEvent('agent_end');
        emitEvent('agent_start');
        emitEvent('agent_end');
        await launch;

        expect(harness.requests.filter((request) => (
            request.type === 'prompt'
            || request.type === 'steer'
            || request.type === 'follow_up'
            || request.type === 'abort_and_prompt'
        ))).toEqual([
            expect.objectContaining({ type: 'prompt', message: 'long turn' }),
            expect.objectContaining({ type: 'steer', message: 'correct direction' }),
            expect.objectContaining({ type: 'follow_up', message: 'next task' }),
            expect.objectContaining({ type: 'abort_and_prompt', message: 'replace the turn' })
        ]);
        expect(harness.requests.some((request) => (
            'message' in request && request.message === 'cancel me'
        ))).toBe(false);
        expect(consumedLocalIds.flat()).toEqual([
            'initial',
            'steer',
            'follow-up-one',
            'replace'
        ]);
        expect(sessionEvents.some((event) => event.type === 'ready')).toBe(true);
    });

    it('marks ordinary streaming prompts with an explicit followUp behavior', async () => {
        harness.autoFinishPrompt = false;
        const { session } = createSessionStub([
            { message: 'active', mode: createMode() }
        ], { closeQueue: false });
        const launch = ompRemoteLauncher(session as never);
        await waitForRequest('prompt');
        emitEvent('agent_start');
        session.queue.push({ text: 'queued ordinary prompt', mode: createMode(), inputMode: 'prompt' });

        await waitForRequestCount('prompt', 2);
        const prompts = harness.requests.filter((request): request is Extract<OmpCommand, { type: 'prompt' }> => (
            request.type === 'prompt'
        ));
        expect(prompts[1]).toEqual(expect.objectContaining({
            type: 'prompt',
            message: 'queued ordinary prompt',
            streamingBehavior: 'followUp'
        }));
        session.queue.close();
        emitEvent('message_end', {
            message: { role: 'user', content: [{ type: 'text', text: 'queued ordinary prompt' }] }
        });
        emitEvent('agent_end');
        await launch;
    });

    it('waits for prompt_result when prompt response omits agentInvoked', async () => {
        harness.autoFinishPrompt = false;
        harness.promptResponse = undefined;
        const { session, sessionEvents } = createSessionStub([
            { message: '/local-only-command', mode: createMode() }
        ]);
        const launch = ompRemoteLauncher(session as never);
        let finished = false;
        void launch.then(() => {
            finished = true;
        });
        await waitForRequest('prompt');
        await Promise.resolve();
        expect(finished).toBe(false);

        emitEvent('prompt_result', { agentInvoked: false });
        await launch;
        expect(sessionEvents.some((event) => event.type === 'ready')).toBe(true);
    });

    it('suppresses ready while OMP reports streaming or queued native work', async () => {
        harness.autoFinishPrompt = false;
        const { session, sessionEvents } = createSessionStub([
            { message: 'native queue check', mode: createMode() }
        ], { closeQueue: false });
        const launch = ompRemoteLauncher(session as never);
        await waitForRequest('prompt');
        emitEvent('agent_start');
        harness.queuedMessageCount = 1;
        emitEvent('agent_end');
        await vi.waitFor(() => {
            expect(harness.requests.filter((request) => request.type === 'get_state').length).toBeGreaterThan(0);
        });
        expect(sessionEvents.some((event) => event.type === 'ready')).toBe(false);

        harness.queuedMessageCount = 0;
        emitEvent('agent_start');
        emitEvent('agent_end');
        await vi.waitFor(() => {
            expect(sessionEvents.some((event) => event.type === 'ready')).toBe(true);
        });
        expect(session.thinking).toBe(false);
        session.queue.close();
        await launch;
    });

    it('sends image bytes through native ImageContent and never inserts @path text', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-omp-launcher-image-'));
        createdDirectories.push(directory);
        const path = join(directory, 'sample.png');
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        await writeFile(path, bytes);
        const { session } = createSessionStub([{
            message: 'describe this image',
            mode: createMode(),
            attachments: [{
                id: 'image',
                filename: 'sample.png',
                mimeType: 'image/png',
                size: bytes.length,
                path
            }]
        }]);

        await ompRemoteLauncher(session as never);

        const prompt = harness.requests.find((request) => request.type === 'prompt');
        expect(prompt).toEqual(expect.objectContaining({
            type: 'prompt',
            message: 'describe this image',
            images: [{
                type: 'image',
                data: bytes.toString('base64'),
                mimeType: 'image/png'
            }]
        }));
        expect(harness.prompts[0]).not.toContain(path);
        expect(harness.prompts[0]).not.toContain('@');
    });

    it('reports and consumes unsupported non-image-only input without prompting OMP', async () => {
        const { session, sessionEvents, consumedLocalIds } = createSessionStub([{
            message: '',
            mode: createMode(),
            localId: 'document-only',
            attachments: [{
                id: 'document',
                filename: 'notes.txt',
                mimeType: 'text/plain',
                size: 5,
                path: '/uploads/notes.txt'
            }]
        }]);

        await ompRemoteLauncher(session as never);

        expect(harness.requests.some((request) => request.type === 'prompt')).toBe(false);
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'OMP RPC supports image attachments only; ignored: notes.txt (text/plain)'
        });
        expect(sessionEvents).toContainEqual({
            type: 'message',
            message: 'Oh My Pi RPC input failed: OMP RPC received no text or supported image attachment'
        });
        expect(consumedLocalIds).toEqual([['document-only']]);
    });

    it('keeps the session usable for a new prompt after native abort', async () => {
        harness.autoFinishPrompt = false;
        const { session, rpcHandlers } = createSessionStub([
            { message: 'abort this', mode: createMode() }
        ], { closeQueue: false });
        const launch = ompRemoteLauncher(session as never);
        await waitForRequest('prompt');
        emitEvent('agent_start');
        const abort = rpcHandlers.get('abort');
        await abort!(undefined);

        session.queue.push({ text: 'works after abort', mode: createMode(), inputMode: 'prompt' });
        await waitForRequestCount('prompt', 2);
        session.queue.close();
        emitEvent('agent_start');
        emitEvent('agent_end');
        await launch;

        expect(harness.prompts).toEqual(['abort this', 'works after abort']);
    });

    it('switches launchers without aborting the native turn or clearing queued input', async () => {
        harness.autoFinishPrompt = false;
        const { session, rpcHandlers } = createSessionStub([
            { message: 'active turn', mode: createMode() }
        ], { closeQueue: false });
        const launch = ompRemoteLauncher(session as never);
        await waitForRequest('prompt');
        session.queue.push({
            text: 'queued for local',
            mode: createMode(),
            inputMode: 'prompt'
        });

        const switchHandler = rpcHandlers.get('switch');
        expect(switchHandler).toBeDefined();
        await switchHandler!(undefined);
        await launch;

        expect(harness.requests.some((request) => request.type === 'abort')).toBe(false);
        expect(session.queue.size()).toBe(1);
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
