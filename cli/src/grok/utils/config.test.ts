import { describe, expect, it } from 'vitest';
import { parseGrokConfiguredModel } from './config';

describe('parseGrokConfiguredModel', () => {
    it('reads the documented [models] default setting', () => {
        expect(parseGrokConfiguredModel('[models]\ndefault = " grok-4.5 "')).toBe('grok-4.5');
    });

    it('does not treat unrelated top-level settings as the model', () => {
        expect(parseGrokConfiguredModel('default_model = "legacy"')).toBeUndefined();
    });
});
