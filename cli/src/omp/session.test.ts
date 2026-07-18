import { describe, expect, it, vi } from 'vitest';
import { OmpInputQueue } from './OmpInputQueue';
import { OmpSession } from './session';
import type { OmpMode } from './types';

function createSession() {
    const updateMetadata = vi.fn();
    const client = {
        keepAlive: vi.fn(),
        updateMetadata,
        sendAgentMessage: vi.fn(),
        sendUserMessage: vi.fn(),
        sendSessionEvent: vi.fn(),
        emitMessagesConsumed: vi.fn()
    };
    const session = new OmpSession({
        api: {} as never,
        client: client as never,
        path: '/work',
        logPath: '/logs/omp.log',
        sessionId: 'requested-resume-id',
        messageQueue: new OmpInputQueue(() => 'mode'),
        onModeChange: () => undefined,
        startedBy: 'runner',
        startingMode: 'remote'
    });
    return { session, updateMetadata };
}

describe('OmpSession native snapshot metadata', () => {
    it('does not persist the requested resume id before native validation', () => {
        const { session, updateMetadata } = createSession();
        try {
            expect(session.sessionId).toBe('requested-resume-id');
            expect(updateMetadata).not.toHaveBeenCalled();
        } finally {
            session.stopKeepAlive();
        }
    });

    it('writes id, file, and name atomically after get_state validation', () => {
        const { session, updateMetadata } = createSession();
        try {
            session.applyNativeSessionSnapshot({
                id: 'validated-id',
                file: '/sessions/validated-id.jsonl',
                name: 'Validated title'
            });

            expect(session.sessionId).toBe('validated-id');
            expect(session.getNativeSession()).toEqual({
                id: 'validated-id',
                file: '/sessions/validated-id.jsonl',
                name: 'Validated title'
            });
            expect(updateMetadata).toHaveBeenCalledOnce();
            const update = updateMetadata.mock.calls[0]?.[0] as (
                metadata: Record<string, unknown>
            ) => Record<string, unknown>;
            expect(update({ path: '/work', host: 'host' })).toEqual({
                path: '/work',
                host: 'host',
                name: 'Validated title',
                ompSession: {
                    id: 'validated-id',
                    file: '/sessions/validated-id.jsonl',
                    name: 'Validated title'
                }
            });
        } finally {
            session.stopKeepAlive();
        }
    });

    it('clears the prior native title when a new snapshot is unnamed', () => {
        const { session, updateMetadata } = createSession();
        try {
            session.applyNativeSessionSnapshot({
                id: 'new-session-id',
                file: '/sessions/new-session-id.jsonl'
            });

            const update = updateMetadata.mock.calls[0]?.[0] as (
                metadata: Record<string, unknown>
            ) => Record<string, unknown>;
            expect(update({
                path: '/work',
                host: 'host',
                name: 'Previous native title',
                ompSession: {
                    id: 'old-session-id',
                    file: '/sessions/old-session-id.jsonl',
                    name: 'Previous native title'
                }
            })).toEqual({
                path: '/work',
                host: 'host',
                ompSession: {
                    id: 'new-session-id',
                    file: '/sessions/new-session-id.jsonl'
                }
            });
        } finally {
            session.stopKeepAlive();
        }
    });
});
