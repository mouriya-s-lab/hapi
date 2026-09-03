import { describe, expect, it } from 'vitest';
import { parsePiSpecialCommand } from './specialCommands';

describe('parsePiSpecialCommand', () => {
    it('parses /compact with optional custom instructions', () => {
        expect(parsePiSpecialCommand('/compact')).toEqual({ type: 'compact' });
        expect(parsePiSpecialCommand('/compact focus on the API design'))
            .toEqual({ type: 'compact', instructions: 'focus on the API design' });
        expect(parsePiSpecialCommand('  /compact   keep tests green  '))
            .toEqual({ type: 'compact', instructions: 'keep tests green' });
        expect(parsePiSpecialCommand('/compact\nmulti-line instructions'))
            .toEqual({ type: 'compact', instructions: 'multi-line instructions' });
    });

    it('parses /session, /model, and /help', () => {
        expect(parsePiSpecialCommand('/session')).toEqual({ type: 'session' });
        expect(parsePiSpecialCommand('/session extra args')).toEqual({ type: 'session' });
        expect(parsePiSpecialCommand('/model')).toEqual({ type: 'model' });
        expect(parsePiSpecialCommand('/model gpt-5.2')).toEqual({ type: 'model', modelId: 'gpt-5.2' });
        expect(parsePiSpecialCommand('/model openai/gpt-5.2')).toEqual({ type: 'model', modelId: 'openai/gpt-5.2' });
        expect(parsePiSpecialCommand('/help')).toEqual({ type: 'help' });
        expect(parsePiSpecialCommand('/COMPACT')).toEqual({ type: 'compact' });
    });

    it('flags terminal-only Pi builtins as unsupported', () => {
        for (const name of ['tree', 'export', 'import', 'reload', 'settings', 'new', 'name', 'login', 'logout', 'quit', 'hotkeys', 'changelog', 'share', 'resume', 'trust', 'fork', 'clone', 'copy', 'scoped-models', 'llama']) {
            expect(parsePiSpecialCommand(`/${name}`)).toEqual({ type: 'unsupported', name });
        }
        expect(parsePiSpecialCommand('/tree some entry')).toEqual({ type: 'unsupported', name: 'tree' });
    });

    it('requires a command-token boundary (no path-like prefixes)', () => {
        expect(parsePiSpecialCommand('/compact.md notes')).toBeNull();
        expect(parsePiSpecialCommand('/compact/notes')).toBeNull();
        expect(parsePiSpecialCommand('/model/config.json')).toBeNull();
        expect(parsePiSpecialCommand('/session-settings')).toBeNull();
    });

    it('leaves extension commands, skills, templates, and prose untouched', () => {
        expect(parsePiSpecialCommand('/my-extension arg')).toBeNull();
        expect(parsePiSpecialCommand('/skill:brave-search latest news')).toBeNull();
        expect(parsePiSpecialCommand('/my_template')).toBeNull();
        expect(parsePiSpecialCommand('/etc/hosts is a path')).toBeNull();
        expect(parsePiSpecialCommand('please /compact now')).toBeNull();
        expect(parsePiSpecialCommand('normal message')).toBeNull();
        expect(parsePiSpecialCommand('')).toBeNull();
        expect(parsePiSpecialCommand('/')).toBeNull();
    });
});
