import { describe, expect, it } from 'vitest';
import { parseGrokCommandOptions } from './commandOptions';

describe('parseGrokCommandOptions', () => {
    it('maps Grok-native effort to HAPI creation config', () => {
        expect(parseGrokCommandOptions(['--effort', 'medium'])).toMatchObject({
            modelReasoningEffort: 'medium'
        });
    });

    it('accepts explicit HAPI remote permission mode', () => {
        expect(parseGrokCommandOptions(['--permission-mode', 'yolo']).permissionMode).toBe('yolo');
    });
});
