import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import type { GrokMode } from './types';

const harness = vi.hoisted(() => ({
    newSessionCalls: 0,
    loadSessionIds: [] as string[],
    setModelIds: [] as string[],
    setModeIds: [] as string[],
    backendOptions: [] as Array<{ model?: string; reasoningEffort?: string | null }>,
    promptCount: 0,
    currentModel: 'grok-4.5' as string | null,
    loadSessionError: null as Error | null,
    setModelError: null as Error | null,
    setModeError: null as Error | null
}));

vi.mock('./utils/grokBackend', () => ({
    createGrokBackend: vi.fn((options: { model?: string; reasoningEffort?: string | null }) => {
        harness.backendOptions.push(options);
        return ({
        initialize: vi.fn(async () => {}),
        authenticateFirstAvailable: vi.fn(async () => {}),
        newSession: vi.fn(async () => {
            harness.newSessionCalls++;
            return 'grok-new-session';
        }),
        loadSession: vi.fn(async ({ sessionId }: { sessionId: string }) => {
            harness.loadSessionIds.push(sessionId);
            if (harness.loadSessionError) throw harness.loadSessionError;
            return sessionId;
        }),
        getSessionModelsMetadata: vi.fn(() => ({
            availableModels: [],
            currentModelId: harness.currentModel
        })),
        setModel: vi.fn(async (_sessionId: string, modelId: string) => {
            harness.setModelIds.push(modelId);
            if (harness.setModelError) throw harness.setModelError;
            harness.currentModel = modelId;
        }),
        setMode: vi.fn(async (_sessionId: string, modeId: string) => {
            harness.setModeIds.push(modeId);
            if (harness.setModeError) throw harness.setModeError;
        }),
        prompt: vi.fn(async () => {
            harness.promptCount++;
        }),
        cancelPrompt: vi.fn(async () => {}),
        respondToPermission: vi.fn(async () => {}),
        onStderrError: vi.fn(),
        onPermissionRequest: vi.fn(),
        disconnect: vi.fn(async () => {})
        });
    })
}));

vi.mock('@/codex/utils/buildHapiMcpBridge', () => ({
    buildHapiMcpBridge: async () => ({ server: { stop() {} }, mcpServers: {} })
}));

vi.mock('./utils/permissionHandler', () => ({
    GrokPermissionHandler: class {
        async cancelAll(): Promise<void> {}
    }
}));

vi.mock('@/ui/ink/GrokDisplay', () => ({ GrokDisplay: () => null }));
vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

import { grokRemoteLauncher } from './grokRemoteLauncher';
import { GrokSessionController } from './sessionController';

function mode(config: Partial<GrokMode> = {}): GrokMode {
    return { permissionMode: 'default', ...config };
}

function createSession(items: Array<{ message: string; mode: GrokMode }>, resumeSessionId: string | null = null) {
    const queue = new MessageQueue2<GrokMode>((value) => JSON.stringify(value));
    for (const item of items) queue.push(item.message, item.mode);
    queue.close();

    const events: Array<{ type: string; message?: string }> = [];
    const session = {
        path: '/tmp/hapi-grok-test',
        logPath: '/tmp/hapi-grok-test/test.log',
        queue,
        sessionId: resumeSessionId,
        client: {
            rpcHandlerManager: { registerHandler: vi.fn() },
            sendAgentMessage: vi.fn(),
            sendUserMessage: vi.fn(),
            sendSessionEvent: (event: { type: string; message?: string }) => events.push(event),
            updateAgentState: vi.fn()
        },
        getPermissionMode: () => 'default',
        getModelReasoningEffort: () => null,
        onSessionFound(id: string) { session.sessionId = id; },
        onThinkingChange: vi.fn(),
        sendAgentMessage: vi.fn(),
        sendSessionEvent: (event: { type: string; message?: string }) => events.push(event)
    };
    return { session, events };
}

describe('Grok remote session state transitions', () => {
    afterEach(() => {
        harness.newSessionCalls = 0;
        harness.loadSessionIds = [];
        harness.setModelIds = [];
        harness.setModeIds = [];
        harness.backendOptions = [];
        harness.promptCount = 0;
        harness.currentModel = 'grok-4.5';
        harness.loadSessionError = null;
        harness.setModelError = null;
        harness.setModeError = null;
    });

    const controller = (sessionId?: string) => new GrokSessionController({
        sessionId,
        control: { kind: 'remote' },
        permissionMode: 'default'
    });

    it('creates only for a fresh identity and loads only for an existing identity', async () => {
        const fresh = createSession([]);
        const freshController = controller();
        await grokRemoteLauncher(fresh.session as never, { controller: freshController });
        expect(harness.newSessionCalls).toBe(1);
        expect(freshController.snapshot().identity).toEqual({ kind: 'persisted', sessionId: 'grok-new-session' });

        const resumed = createSession([], 'grok-existing-session');
        await grokRemoteLauncher(resumed.session as never, { controller: controller('grok-existing-session') });
        expect(harness.loadSessionIds).toEqual(['grok-existing-session']);
        expect(harness.newSessionCalls).toBe(1);
    });

    it('fails a stale resume without replacing the conversation with a new identity', async () => {
        harness.loadSessionError = new Error('session not found');
        const resumed = createSession([], 'grok-stale-session');
        await expect(grokRemoteLauncher(resumed.session as never, {
            controller: controller('grok-stale-session')
        })).rejects.toThrow('session not found');
        expect(harness.newSessionCalls).toBe(0);
        expect(resumed.session.sessionId).toBe('grok-stale-session');
    });

    it('does not pass a launch model to the backend before loading an existing session', async () => {
        const resumed = createSession([], 'grok-existing-session');
        await grokRemoteLauncher(resumed.session as never, {
            model: 'grok-4.5',
            controller: controller('grok-existing-session')
        });
        expect(harness.backendOptions.at(-1)?.model).toBeUndefined();
    });

    it('never mutates reasoning effort through ACP mode calls', async () => {
        const { session } = createSession([{ message: 'one', mode: mode({ modelReasoningEffort: 'low' }) }]);
        await grokRemoteLauncher(session as never, { controller: controller() });
        expect(harness.setModeIds).toEqual([]);
    });
});
