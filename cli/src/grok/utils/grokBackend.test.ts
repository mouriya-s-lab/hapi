import { describe, expect, it } from 'vitest';
import { buildGrokAgentArgs } from './grokBackend';

describe('buildGrokAgentArgs', () => {
    it('places agent-level options before the stdio transport without pinning approval mode', () => {
        expect(buildGrokAgentArgs({ model: 'grok-4.5', permissionMode: 'yolo' })).toEqual([
            '--permission-mode',
            'default',
            'agent',
            '--model',
            'grok-4.5',
            'stdio'
        ]);
    });

    it('uses the authenticated Grok default without inventing flags', () => {
        expect(buildGrokAgentArgs({})).toEqual(['--permission-mode', 'default', 'agent', 'stdio']);
    });
});
