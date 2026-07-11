import { describe, expect, it } from 'vitest';
import { buildGrokLocalArgs } from './grokLocal';

describe('buildGrokLocalArgs', () => {
    it('resumes the exact Grok session and preserves launch configuration', () => {
        expect(buildGrokLocalArgs({
            sessionId: '019f5343-cedc-7d22-808e-34c9e61c125c',
            model: 'grok-4.5',
            reasoningEffort: 'medium',
            yolo: true
        })).toEqual([
            '--resume', '019f5343-cedc-7d22-808e-34c9e61c125c',
            '--model', 'grok-4.5',
            '--always-approve',
            '--reasoning-effort', 'medium'
        ]);
    });
});
