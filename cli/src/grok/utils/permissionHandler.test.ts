import { describe, expect, it } from 'vitest';
import { mapAutoApprovalToOutcome, mapDecisionToOutcome } from './permissionHandler';
import type { PermissionRequest } from '@/agent/types';

const request: PermissionRequest = {
    id: 'permission-1',
    sessionId: 'session-1',
    toolCallId: 'tool-1',
    options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }]
};

describe('mapDecisionToOutcome', () => {
    it('cancels a denial when the agent offers no reject option', () => {
        expect(mapDecisionToOutcome(request, 'denied')).toEqual({ outcome: 'cancelled' });
    });

    it('does not turn a one-time approval into a persistent grant', () => {
        expect(mapDecisionToOutcome({
            ...request,
            options: [{ optionId: 'always', name: 'Always allow', kind: 'allow_always' }]
        }, 'approved')).toEqual({ outcome: 'cancelled' });
    });

    it('does not turn a one-time denial into a persistent rejection', () => {
        expect(mapDecisionToOutcome({
            ...request,
            options: [{ optionId: 'reject-always', name: 'Always reject', kind: 'reject_always' }]
        }, 'denied')).toEqual({ outcome: 'cancelled' });
    });

    it('does not report session approval when only allow-once is available', () => {
        expect(mapDecisionToOutcome(request, 'approved_for_session')).toEqual({ outcome: 'cancelled' });
    });
});

describe('mapAutoApprovalToOutcome', () => {
    it('uses allow-once even when yolo is represented as a session approval', () => {
        expect(mapAutoApprovalToOutcome({
            ...request,
            options: [
                { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
                { optionId: 'once', name: 'Allow once', kind: 'allow_once' }
            ]
        })).toEqual({ outcome: 'selected', optionId: 'once' });
    });

    it('does not create a persistent backend grant when allow-once is unavailable', () => {
        expect(mapAutoApprovalToOutcome({
            ...request,
            options: [{ optionId: 'always', name: 'Always allow', kind: 'allow_always' }]
        })).toEqual({ outcome: 'cancelled' });
    });
});
