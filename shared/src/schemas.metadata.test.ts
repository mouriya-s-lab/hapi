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

describe('MetadataSchema historyImport', () => {
    const base = { path: '/tmp', host: 'test' };
    const source = { provider: 'codex' as const, externalSessionId: 'thread-1' };

    it('accepts importing, completed, and failed lifecycle variants', () => {
        expect(MetadataSchema.safeParse({ ...base, historyImport: { type: 'importing', ...source, startedAt: 1 } }).success).toBe(true);
        expect(MetadataSchema.safeParse({ ...base, historyImport: { type: 'completed', ...source, completedAt: 2, messageCount: 8 } }).success).toBe(true);
        expect(MetadataSchema.safeParse({ ...base, historyImport: { type: 'failed', ...source, failedAt: 3, error: 'bad transcript' } }).success).toBe(true);
    });

    it('rejects completed imports without a message count', () => {
        expect(MetadataSchema.safeParse({ ...base, historyImport: { type: 'completed', ...source, completedAt: 2 } }).success).toBe(false);
    });
});
