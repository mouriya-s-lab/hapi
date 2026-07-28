import { describe, expect, it } from 'vitest';
import { MetadataSchema } from './schemas';

describe('MetadataSchema cursorSessionProtocol', () => {
    const base = {
        path: '/tmp',
        host: 'test'
    };

    it('accepts acp and stream-json protocol values', () => {
        expect(MetadataSchema.safeParse({ ...base, cursorSessionProtocol: 'acp' }).success).toBe(true);
        expect(MetadataSchema.safeParse({ ...base, cursorSessionProtocol: 'stream-json' }).success).toBe(true);
    });

    it('rejects unknown protocol values', () => {
        expect(MetadataSchema.safeParse({ ...base, cursorSessionProtocol: 'websocket' }).success).toBe(false);
    });
});

describe('MetadataSchema OMP thinking state', () => {
    const base = { path: '/tmp', host: 'test' };

    it('keeps configured auto distinct from effective and resolved thinking', () => {
        const parsed = MetadataSchema.parse({
            ...base,
            ompThinking: {
                thinkingLevel: 'high',
                configured: 'auto',
                resolved: 'high'
            }
        });
        expect(parsed.ompThinking).toEqual({
            thinkingLevel: 'high',
            configured: 'auto',
            resolved: 'high'
        });
    });

    it('rejects auto as an effective or resolved value', () => {
        expect(MetadataSchema.safeParse({
            ...base,
            ompThinking: { thinkingLevel: 'auto', configured: 'auto', resolved: null }
        }).success).toBe(false);
        expect(MetadataSchema.safeParse({
            ...base,
            ompThinking: { thinkingLevel: 'high', configured: 'auto', resolved: 'auto' }
        }).success).toBe(false);
    });
});
