import { describe, expect, it } from 'vitest';
import { mapDecisionToOutcome } from './permissionHandler';
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
