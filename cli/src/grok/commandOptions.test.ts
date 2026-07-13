import { describe, expect, it } from 'vitest';
import { parseGrokCommandOptions } from './commandOptions';

describe('parseGrokCommandOptions', () => {
    it('maps Grok-native effort and approval flags to HAPI runtime config', () => {
        expect(parseGrokCommandOptions(['--effort', 'medium', '--always-approve'])).toMatchObject({
            modelReasoningEffort: 'medium',
            permissionMode: 'yolo'
        });
    });

    it('keeps an explicit HAPI permission mode authoritative', () => {
        expect(parseGrokCommandOptions(['--always-approve', '--permission-mode', 'default']).permissionMode).toBe('default');
    });
});
