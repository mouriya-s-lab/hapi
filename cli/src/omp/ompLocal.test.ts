import { describe, expect, it } from 'vitest';
import { buildOmpLocalArgs } from './ompLocal';

describe('buildOmpLocalArgs', () => {
    it('pins local OMP sessions to native yolo execution', () => {
        expect(buildOmpLocalArgs({ sessionId: null })).toEqual([
            '--approval-mode', 'yolo'
        ]);
    });

    it('keeps resume, model, and thinking arguments before fixed yolo', () => {
        expect(buildOmpLocalArgs({
            sessionId: 'native-session',
            model: 'openai-codex/gpt-5.4-mini',
            effort: 'auto'
        })).toEqual([
            '--resume', 'native-session',
            '--model', 'openai-codex/gpt-5.4-mini',
            '--thinking', 'auto',
            '--approval-mode', 'yolo'
        ]);
    });
});
