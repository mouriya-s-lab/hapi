import { describe, expect, it, vi } from 'vitest';
import type { OmpCommand, OmpSessionState } from './types';
import {
    nativeSessionSnapshotFromState,
    parseOmpSessionMutation,
    runOmpSessionMutation
} from './sessionLifecycle';

function state(id: string = 'session-2'): OmpSessionState {
    return {
        isStreaming: false,
        isCompacting: false,
        steeringMode: 'all',
        followUpMode: 'all',
        interruptMode: 'immediate',
        sessionId: id,
        sessionFile: `/sessions/${id}.jsonl`,
        sessionName: 'Renamed session',
        autoCompactionEnabled: true,
        messageCount: 0,
        queuedMessageCount: 0,
        todoPhases: []
    };
}

describe('OMP native session lifecycle', () => {
    it('parses only the native session slash commands', () => {
        expect(parseOmpSessionMutation(' /clear ')).toEqual({ type: 'new_session' });
        expect(parseOmpSessionMutation('/new')).toEqual({ type: 'new_session' });
        expect(parseOmpSessionMutation('/rename  Renamed session ')).toEqual({
            type: 'set_session_name',
            name: 'Renamed session'
        });
        expect(parseOmpSessionMutation('/handoff focus on verification')).toEqual({
            type: 'handoff',
            customInstructions: 'focus on verification'
        });
        expect(parseOmpSessionMutation('/handoff')).toEqual({ type: 'handoff' });
        expect(parseOmpSessionMutation('/resume 019f75fa')).toEqual({
            type: 'resume_session',
            sessionArg: '019f75fa'
        });
        expect(parseOmpSessionMutation('/resume')).toEqual({ type: 'resume_session_picker' });
        expect(parseOmpSessionMutation('/rename')).toEqual({
            type: 'invalid_session_command',
            message: 'Usage: /rename <title>'
        });
        expect(parseOmpSessionMutation('/clear\nnext prompt')).toBeNull();
    });

    it('constructs the authoritative metadata snapshot from get_state', () => {
        expect(nativeSessionSnapshotFromState(state())).toEqual({
            id: 'session-2',
            file: '/sessions/session-2.jsonl',
            name: 'Renamed session'
        });
    });

    it('rejects a state that does not expose sessionFile', () => {
        const missingFile = state();
        delete missingFile.sessionFile;
        expect(() => nativeSessionSnapshotFromState(missingFile)).toThrow(/persisted session file/);
    });

    it('runs get_state immediately after set_session_name and applies one atomic snapshot', async () => {
        const calls: OmpCommand[] = [];
        const apply = vi.fn();
        const client = {
            request: vi.fn(async (command: OmpCommand) => {
                calls.push(command);
                return command.type === 'get_state' ? state() : undefined;
            })
        };

        const outcome = await runOmpSessionMutation(
            client as never,
            { type: 'set_session_name', name: 'Renamed session' },
            apply
        );

        expect(calls).toEqual([
            { type: 'set_session_name', name: 'Renamed session' },
            { type: 'get_state' }
        ]);
        expect(outcome.status).toBe('applied');
        expect(apply).toHaveBeenCalledOnce();
        expect(apply).toHaveBeenCalledWith({
            id: 'session-2',
            file: '/sessions/session-2.jsonl',
            name: 'Renamed session'
        });
    });

    it('runs get_state after a successful new_session mutation', async () => {
        const calls: string[] = [];
        const client = {
            request: vi.fn(async (command: OmpCommand) => {
                calls.push(command.type);
                if (command.type === 'new_session') return { cancelled: false };
                if (command.type === 'get_state') return state('fresh-session');
                throw new Error(`Unexpected command ${command.type}`);
            })
        };

        const outcome = await runOmpSessionMutation(
            client as never,
            { type: 'new_session' },
            () => undefined
        );

        expect(calls).toEqual(['new_session', 'get_state']);
        expect(outcome).toMatchObject({
            status: 'applied',
            snapshot: { id: 'fresh-session', file: '/sessions/fresh-session.jsonl' }
        });
    });

    it('does not reconcile a cancelled branch mutation', async () => {
        const calls: string[] = [];
        const client = {
            request: vi.fn(async (command: OmpCommand) => {
                calls.push(command.type);
                return { text: 'target', cancelled: true };
            })
        };

        const outcome = await runOmpSessionMutation(
            client as never,
            { type: 'branch', entryId: 'entry-1' },
            () => undefined
        );

        expect(outcome.status).toBe('unchanged');
        expect(calls).toEqual(['branch']);
    });

    it('runs get_state after successful switch_session and handoff mutations', async () => {
        const calls: OmpCommand[] = [];
        const client = {
            request: vi.fn(async (command: OmpCommand) => {
                calls.push(command);
                if (command.type === 'switch_session') return { cancelled: false };
                if (command.type === 'handoff') return { savedPath: '/handoff.md' };
                if (command.type === 'get_state') return state();
                throw new Error(`Unexpected command ${command.type}`);
            })
        };

        await runOmpSessionMutation(
            client as never,
            { type: 'switch_session', sessionPath: '/sessions/session-2.jsonl' },
            () => undefined
        );
        await runOmpSessionMutation(
            client as never,
            { type: 'handoff', customInstructions: 'continue verification' },
            () => undefined
        );

        expect(calls.map((command) => command.type)).toEqual([
            'switch_session',
            'get_state',
            'handoff',
            'get_state'
        ]);
    });
});
