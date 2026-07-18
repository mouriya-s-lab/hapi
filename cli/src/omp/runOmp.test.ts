import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    loopArgs: [] as Array<Record<string, unknown>>,
    loopError: null as Error | null,
    metadata: { path: '/work', host: 'host' } as Record<string, unknown>,
    session: {
        onUserMessage: vi.fn(),
        onCancelQueuedMessage: vi.fn(),
        updateAgentState: vi.fn(),
        sendSessionEvent: vi.fn(),
        rpcHandlerManager: { registerHandler: vi.fn() }
    },
    wrapper: {
        setPermissionMode: vi.fn(),
        setModel: vi.fn(),
        pushKeepAlive: vi.fn(),
        stopKeepAlive: vi.fn(),
        localLaunchFailure: null
    }
}));

vi.mock('@/agent/sessionFactory', () => ({
    bootstrapSession: vi.fn(async () => ({
        api: {},
        session: harness.session,
        metadata: harness.metadata
    })),
    bootstrapExistingSession: vi.fn(async () => ({
        api: {},
        session: harness.session,
        metadata: harness.metadata
    }))
}));

vi.mock('./loop', () => ({
    ompLoop: vi.fn(async (options: Record<string, unknown>) => {
        harness.loopArgs.push(options);
        const onSessionReady = options.onSessionReady as ((value: unknown) => void) | undefined;
        onSessionReady?.(harness.wrapper);
        if (harness.loopError) throw harness.loopError;
    })
}));

const lifecycle = vi.hoisted(() => ({
    registerProcessHandlers: vi.fn(),
    cleanupAndExit: vi.fn(async () => undefined),
    markCrash: vi.fn(),
    setExitCode: vi.fn(),
    setArchiveReason: vi.fn(),
    setSessionEndReason: vi.fn(),
    hasExplicitSessionEndReason: vi.fn(() => false)
}));

vi.mock('@/agent/runnerLifecycle', () => ({
    createRunnerLifecycle: vi.fn(() => lifecycle),
    createModeChangeHandler: vi.fn(() => vi.fn()),
    setControlledByUser: vi.fn()
}));

const registerKillSessionHandler = vi.hoisted(() => vi.fn());
vi.mock('@/claude/registerKillSessionHandler', () => ({ registerKillSessionHandler }));
vi.mock('@/agent/localHandoff', () => ({ registerLocalHandoffHandler: vi.fn() }));
vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), getLogPath: vi.fn(() => '/logs/omp.log') }
}));
vi.mock('@/utils/attachmentFormatter', () => ({ formatMessageWithAttachments: vi.fn((text: string) => text) }));
vi.mock('@/utils/invokedCwd', () => ({ getInvokedCwd: vi.fn(() => '/work') }));

import { runOmp } from './runOmp';
import type { MessageQueue2 } from '@/utils/MessageQueue2';
import type { OmpMode } from './types';

describe('runOmp lifecycle', () => {
    beforeEach(() => {
        harness.loopArgs.length = 0;
        harness.loopError = null;
        harness.metadata = { path: '/work', host: 'host' };
        harness.session.onUserMessage.mockReset();
        harness.session.onCancelQueuedMessage.mockReset();
        harness.session.updateAgentState.mockReset();
        harness.session.sendSessionEvent.mockReset();
        harness.session.rpcHandlerManager.registerHandler.mockReset();
        registerKillSessionHandler.mockReset();
        lifecycle.registerProcessHandlers.mockReset();
        lifecycle.cleanupAndExit.mockReset();
        lifecycle.cleanupAndExit.mockResolvedValue(undefined);
        lifecycle.markCrash.mockReset();
        lifecycle.setExitCode.mockReset();
        lifecycle.setArchiveReason.mockReset();
        lifecycle.setSessionEndReason.mockReset();
    });

    it('forces a runner-owned launch away from terminal local mode', async () => {
        await runOmp({ startedBy: 'runner', startingMode: 'local', workingDirectory: '/work' });
        expect(harness.loopArgs[0]?.startingMode).toBe('remote');
    });

    it('registers the full lifecycle so user kill is classified as terminated', async () => {
        await runOmp({ startedBy: 'runner', startingMode: 'remote', workingDirectory: '/work' });
        expect(registerKillSessionHandler).toHaveBeenCalledWith(
            harness.session.rpcHandlerManager,
            lifecycle
        );
    });

    it('passes an existing snapshot only when it matches the requested native id', async () => {
        harness.metadata = {
            path: '/work',
            host: 'host',
            ompSession: { id: 'native-id', file: '/sessions/native-id.jsonl' }
        };
        await runOmp({
            existingSessionId: 'hapi-id',
            resumeSessionId: 'native-id',
            workingDirectory: '/work',
            startingMode: 'remote'
        });
        expect(harness.loopArgs[0]?.nativeSession).toEqual({
            id: 'native-id',
            file: '/sessions/native-id.jsonl'
        });
    });

    it('isolates every user message so HAPI turns stay aligned with native branch entries', async () => {
        await runOmp({ startingMode: 'remote', workingDirectory: '/work' });
        const onUserMessage = harness.session.onUserMessage.mock.calls[0]?.[0] as (
            message: { content: { text: string } },
            localId: string
        ) => void;
        onUserMessage({ content: { text: '/clear' } }, 'clear-id');
        onUserMessage({ content: { text: '/handoff focus' } }, 'handoff-id');
        onUserMessage({ content: { text: '/resume native-id' } }, 'resume-id');
        onUserMessage({ content: { text: 'next prompt' } }, 'prompt-id');

        const queue = harness.loopArgs[0]?.messageQueue as MessageQueue2<OmpMode>;
        expect(queue.queue.map(({ message, isolate, localId }) => ({ message, isolate, localId }))).toEqual([
            { message: '/clear', isolate: true, localId: 'clear-id' },
            { message: '/handoff focus', isolate: true, localId: 'handoff-id' },
            { message: '/resume native-id', isolate: true, localId: 'resume-id' },
            { message: 'next prompt', isolate: true, localId: 'prompt-id' }
        ]);
    });

    it('reports an explicit error and classifies a native crash separately from user termination', async () => {
        harness.loopError = new Error('native process crashed');
        await runOmp({ startedBy: 'runner', startingMode: 'remote', workingDirectory: '/work' });
        expect(lifecycle.markCrash).toHaveBeenCalledWith(harness.loopError);
        expect(harness.session.sendSessionEvent).toHaveBeenCalledWith({
            type: 'message',
            message: 'OMP session failed: native process crashed'
        });
        expect(lifecycle.setSessionEndReason).not.toHaveBeenCalledWith('completed');
    });
});
