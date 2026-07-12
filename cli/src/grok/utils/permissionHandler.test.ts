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
