import { describe, expect, it } from 'vitest';
import { MachineMetadataSchema, MetadataSchema } from './schemas';

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

    it('persists Pi native history entry ids', () => {
        const result = MetadataSchema.safeParse({
            ...base,
            conversationHistoryEntryIds: { 'local-user-id': 'pi-entry-id' },
        });
        expect(result.success).toBe(true);
        expect(result.data?.conversationHistoryEntryIds).toEqual({ 'local-user-id': 'pi-entry-id' });
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

describe('MachineMetadataSchema runner capabilities', () => {
    it('preserves OMP availability across the machine metadata boundary', () => {
        const parsed = MachineMetadataSchema.parse({
            host: 'runner',
            platform: 'darwin',
            happyCliVersion: '1.0.0',
            capabilities: { omp: true }
        });

        expect(parsed.capabilities).toEqual({ omp: true });
    });
});
