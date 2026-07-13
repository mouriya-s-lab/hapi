import { describe, expect, it } from 'vitest';
import {
    assertGrokRuntimeConfigOwnership,
    parseRuntimeConfigRequest,
    resolveGrokHandoffModel,
    resolveGrokReasoningEffort,
    resolveRuntimeConfigRequest
} from './runtimeConfigState';

describe('Grok runtime config request semantics', () => {
    it('keeps omitted, reset, and explicit values distinct', () => {
        expect(parseRuntimeConfigRequest(undefined)).toEqual({ kind: 'unchanged' });
        expect(parseRuntimeConfigRequest(null)).toEqual({ kind: 'reset' });
        expect(parseRuntimeConfigRequest('low')).toEqual({ kind: 'set', value: 'low' });
    });

    it('resolves reset to the captured launch default without inventing an omitted request', () => {
        expect(resolveRuntimeConfigRequest({ kind: 'unchanged' }, 'high')).toBeUndefined();
        expect(resolveRuntimeConfigRequest({ kind: 'reset' }, 'high')).toBe('high');
        expect(resolveRuntimeConfigRequest({ kind: 'set', value: 'low' }, 'high')).toBe('low');
    });
});

describe('Grok handoff config', () => {
    it('preserves an explicit Default reset instead of restoring the launch model', () => {
        expect(resolveGrokHandoffModel(undefined, 'grok-4.5')).toBe('grok-4.5');
        expect(resolveGrokHandoffModel(null, 'grok-4.5')).toBeUndefined();
        expect(resolveGrokHandoffModel('grok-composer-2.5-fast', 'grok-4.5')).toBe('grok-composer-2.5-fast');
    });

    it('clears unsupported effort when the resolved model is Composer', () => {
        expect(resolveGrokReasoningEffort('grok-composer-2.5-fast', 'medium')).toBeNull();
        expect(resolveGrokReasoningEffort('grok-4.5', 'medium')).toBe('medium');
    });
});

describe('Grok runtime config ownership', () => {
    it('rejects config mutation under local control and allows it under remote control', () => {
        expect(() => assertGrokRuntimeConfigOwnership('local', true)).toThrow(
            'local CLI controls the session'
        );
        expect(() => assertGrokRuntimeConfigOwnership('remote', true)).not.toThrow();
        expect(() => assertGrokRuntimeConfigOwnership('local', false)).not.toThrow();
    });
});
