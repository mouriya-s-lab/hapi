import { describe, expect, it } from 'vitest';
import {
    resolveGrokHandoffModel,
    resolveGrokReasoningEffort
} from './runtimeConfigState';

describe('Grok handoff config', () => {
    it('preserves an explicit Default reset instead of restoring the launch model', () => {
        expect(resolveGrokHandoffModel(undefined, 'grok-4.5')).toBe('grok-4.5');
        expect(resolveGrokHandoffModel(null, 'grok-4.5')).toBeUndefined();
        expect(resolveGrokHandoffModel('grok-composer-2.5-fast', 'grok-4.5')).toBe('grok-composer-2.5-fast');
    });

    it('accepts effort only for an explicit verified Grok 4.5 model', () => {
        expect(resolveGrokReasoningEffort('grok-4.5', 'medium')).toBe('medium');
        expect(() => resolveGrokReasoningEffort('grok-composer-2.5-fast', 'medium')).toThrow('explicit grok-4.5');
        expect(() => resolveGrokReasoningEffort(undefined, 'medium')).toThrow('explicit grok-4.5');
        expect(() => resolveGrokReasoningEffort('future-model', 'medium')).toThrow('explicit grok-4.5');
    });
});
