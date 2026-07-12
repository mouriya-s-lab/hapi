import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import type { GrokMode } from './types';

const harness = vi.hoisted(() => ({
    newSessionCalls: 0,
    loadSessionIds: [] as string[],
    setModelIds: [] as string[],
    setModeIds: [] as string[],
    promptCount: 0,
    currentModel: 'grok-4.5' as string | null,
    loadSessionError: null as Error | null,
    setModelError: null as Error | null,
    setModeError: null as Error | null
}));

vi.mock('./utils/grokBackend', () => ({
    createGrokBackend: vi.fn(() => ({
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
    }))
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

import { getGrokAuthPreference, grokRemoteLauncher } from './grokRemoteLauncher';

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
        harness.promptCount = 0;
        harness.currentModel = 'grok-4.5';
        harness.loadSessionError = null;
        harness.setModelError = null;
        harness.setModeError = null;
    });

    it('creates only for a fresh identity and loads only for an existing identity', async () => {
        const fresh = createSession([]);
        await grokRemoteLauncher(fresh.session as never, {});
        expect(harness.newSessionCalls).toBe(1);
        expect(fresh.session.sessionId).toBe('grok-new-session');

        const resumed = createSession([], 'grok-existing-session');
        await grokRemoteLauncher(resumed.session as never, {});
        expect(harness.loadSessionIds).toEqual(['grok-existing-session']);
        expect(harness.newSessionCalls).toBe(1);
    });

    it('fails a stale resume without replacing the conversation with a new identity', async () => {
        harness.loadSessionError = new Error('session not found');
        const resumed = createSession([], 'grok-stale-session');
        await expect(grokRemoteLauncher(resumed.session as never, {})).rejects.toThrow('session not found');
        expect(harness.newSessionCalls).toBe(0);
        expect(resumed.session.sessionId).toBe('grok-stale-session');
    });

    it('applies explicit model changes and resets to the captured launch model', async () => {
        const { session } = createSession([
            { message: 'one', mode: mode({ model: 'grok-composer-2.5-fast' }) },
            { message: 'two', mode: mode({ model: null }) }
        ]);
        await grokRemoteLauncher(session as never, {});
        expect(harness.setModelIds).toEqual(['grok-composer-2.5-fast', 'grok-4.5']);
        expect(harness.promptCount).toBe(2);
    });

    it('does not turn an omitted model into a reset request', async () => {
        const { session } = createSession([{ message: 'one', mode: mode() }]);
        await grokRemoteLauncher(session as never, {});
        expect(harness.setModelIds).toEqual([]);
    });

    it('rolls Default back to the applied model when the backend did not report a launch default', async () => {
        harness.currentModel = null;
        const rollback = vi.fn();
        const { session } = createSession([
            { message: 'one', mode: mode({ model: 'grok-composer-2.5-fast' }) },
            { message: 'two', mode: mode({ model: null }) }
        ]);
        await grokRemoteLauncher(session as never, { onModelRollback: rollback });
        expect(harness.setModelIds).toEqual(['grok-composer-2.5-fast']);
        expect(rollback).toHaveBeenCalledWith('grok-composer-2.5-fast');
    });

    it('rolls rejected model changes back to the applied backend model', async () => {
        harness.setModelError = new Error('agent type cannot switch');
        const rollback = vi.fn();
        const { session } = createSession([{ message: 'one', mode: mode({ model: 'grok-composer-2.5-fast' }) }]);
        await grokRemoteLauncher(session as never, { onModelRollback: rollback });
        expect(rollback).toHaveBeenCalledWith('grok-4.5');
        expect(harness.promptCount).toBe(1);
    });

    it('keeps omitted, explicit, and reset effort transitions distinct', async () => {
        const { session } = createSession([
            { message: 'one', mode: mode() },
            { message: 'two', mode: mode({ modelReasoningEffort: 'low' }) },
            { message: 'three', mode: mode({ modelReasoningEffort: null }) }
        ]);
        await grokRemoteLauncher(session as never, {});
        expect(harness.setModeIds).toEqual(['low', 'high']);
    });

    it('rolls rejected effort changes back to the applied effort', async () => {
        harness.setModeError = new Error('unsupported effort');
        const rollback = vi.fn();
        const { session } = createSession([{ message: 'one', mode: mode({ modelReasoningEffort: 'low' }) }]);
        await grokRemoteLauncher(session as never, { onReasoningEffortRollback: rollback });
        expect(rollback).toHaveBeenCalledWith(null);
        expect(harness.promptCount).toBe(1);
    });

    it('clears stale effort instead of applying it after switching to Composer', async () => {
        const rollback = vi.fn();
        const { session } = createSession([
            { message: 'one', mode: mode({ modelReasoningEffort: 'medium' }) },
            { message: 'two', mode: mode({ model: 'grok-composer-2.5-fast', modelReasoningEffort: 'medium' }) }
        ]);
        await grokRemoteLauncher(session as never, { onReasoningEffortRollback: rollback });
        expect(harness.setModeIds).toEqual(['medium']);
        expect(rollback).toHaveBeenCalledWith(null);
    });
});

describe('getGrokAuthPreference', () => {
    it('prefers cached login unless XAI_API_KEY is present', () => {
        expect(getGrokAuthPreference({})).toEqual(['cached_token', 'xai.api_key']);
        expect(getGrokAuthPreference({ XAI_API_KEY: 'configured' })).toEqual(['xai.api_key', 'cached_token']);
    });
});
