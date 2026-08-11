import { beforeEach, describe, expect, it, vi } from 'vitest';

const { constructorOptions } = vi.hoisted(() => ({
    constructorOptions: [] as unknown[]
}));

vi.mock('node:os', async () => {
    const actual = await vi.importActual<typeof import('node:os')>('node:os');
    return { ...actual, homedir: vi.fn(() => '/neutral-home') };
});

vi.mock('@/codex/codexAppServerClient', () => ({
    CodexAppServerClient: class {
        constructor(options: unknown) {
            constructorOptions.push(options);
        }

        async connect(): Promise<void> {}
        async initialize(): Promise<void> {}
        async listModels(): Promise<{ data: unknown[] }> {
            return { data: [] };
        }
        async disconnect(): Promise<void> {}
    }
}));

import { listCodexModels } from './codexModels';

describe('listCodexModels cwd', () => {
    beforeEach(() => {
        constructorOptions.length = 0;
    });

    it('starts discovery from the user home instead of the caller cwd', async () => {
        await listCodexModels();

        expect(constructorOptions).toEqual([{ cwd: '/neutral-home' }]);
    });
});
