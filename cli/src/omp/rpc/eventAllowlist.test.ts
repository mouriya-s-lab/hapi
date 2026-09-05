import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readFileMock } = vi.hoisted(() => ({
    readFileMock: vi.fn<() => Promise<string>>()
}));

vi.mock('node:fs/promises', () => ({ readFile: readFileMock }));
vi.mock('@/configuration', () => ({
    configuration: { settingsFile: '/isolated-hapi/settings.json' }
}));

import { loadOmpEventAllowlist } from './eventAllowlist';

describe('OMP event allowlist configuration', () => {
    beforeEach(() => {
        vi.stubEnv('HAPI_OMP_EVENT_ALLOWLIST_JSON', undefined);
        readFileMock.mockReset();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('replaces file and defaults with an environment selection, even for a corrupt file', async () => {
        readFileMock.mockResolvedValue('not-json');
        vi.stubEnv('HAPI_OMP_EVENT_ALLOWLIST_JSON', '["advisor_yielded"]');
        expect([...await loadOmpEventAllowlist()]).toEqual(['advisor_yielded']);
    });

    it('replaces defaults with the file selection and rereads it at the next launch', async () => {
        readFileMock.mockResolvedValueOnce('{"ompEventAllowlist":["tool_stream_update"],"machineId":"existing"}');
        const firstLaunch = await loadOmpEventAllowlist();
        readFileMock.mockResolvedValueOnce('{"ompEventAllowlist":["available_commands_update"]}');
        expect([...await loadOmpEventAllowlist()]).toEqual(['available_commands_update']);
        expect([...firstLaunch]).toEqual(['tool_stream_update']);
    });

    it('accepts an empty file selection and an empty environment replacement', async () => {
        readFileMock.mockResolvedValue('{"ompEventAllowlist":[]}');
        expect([...await loadOmpEventAllowlist()]).toEqual([]);
        readFileMock.mockResolvedValue('{"ompEventAllowlist":["notice"]}');
        vi.stubEnv('HAPI_OMP_EVENT_ALLOWLIST_JSON', '[]');
        expect([...await loadOmpEventAllowlist()]).toEqual([]);
    });

    it.each([
        ['not-json', 'valid JSON'],
        ['{}', 'array'],
        ['[1]', 'string'],
        ['["future_event"]', 'unknown'],
        ['["notice","notice"]', 'duplicate'],
        ['', 'valid JSON']
    ])('rejects invalid environment %s rather than using valid file settings', async (value, reason) => {
        readFileMock.mockResolvedValue('{"ompEventAllowlist":["notice"]}');
        vi.stubEnv('HAPI_OMP_EVENT_ALLOWLIST_JSON', value);
        await expect(loadOmpEventAllowlist()).rejects.toThrow(`HAPI_OMP_EVENT_ALLOWLIST_JSON`);
        await expect(loadOmpEventAllowlist()).rejects.toThrow(reason);
    });

    it.each([
        'not-json',
        '[]',
        'null',
        '{"ompEventAllowlist":null}',
        '{"ompEventAllowlist":{}}',
        '{"ompEventAllowlist":[1]}',
        '{"ompEventAllowlist":["future_event"]}',
        '{"ompEventAllowlist":["notice","notice"]}'
    ])('rejects invalid settings %s instead of the permissive readSettings fallback', async (content) => {
        readFileMock.mockResolvedValue(content);
        await expect(loadOmpEventAllowlist()).rejects.toThrow('/isolated-hapi/settings.json ompEventAllowlist');
    });

    it('distinguishes a missing settings file from an unreadable one', async () => {
        readFileMock.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
        const missingFile = await loadOmpEventAllowlist();
        readFileMock.mockResolvedValueOnce('{"machineId":"existing"}');
        expect(await loadOmpEventAllowlist()).toEqual(missingFile);
        readFileMock.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
        await expect(loadOmpEventAllowlist()).rejects.toThrow('Unable to read /isolated-hapi/settings.json ompEventAllowlist');
    });
});
