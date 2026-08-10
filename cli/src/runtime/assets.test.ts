import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform, tmpdir } from 'node:os';

import packageJson from '../../package.json';

const mockState = vi.hoisted(() => ({
    runtimeRoot: '',
    assets: [] as Array<{ relativePath: string; sourcePath: string }>
}));

vi.mock('@/projectPath', () => ({
    isBunCompiled: () => true,
    runtimePath: () => mockState.runtimeRoot
}));

vi.mock('#embedded-assets', () => ({
    loadEmbeddedAssets: async () => mockState.assets
}));

import { ensureRuntimeAssets } from './assets';

describe('ensureRuntimeAssets canonical skill staging', () => {
    let testRoot: string;
    let stagedSkillPath: string;
    let canonicalContent: string;

    beforeEach(() => {
        testRoot = mkdtempSync(join(tmpdir(), 'hapi-runtime-assets-'));
        mockState.runtimeRoot = join(testRoot, 'runtime');
        canonicalContent = 'canonical embedded hapi-agent skill\n';

        const canonicalSource = join(testRoot, 'embedded', 'SKILL.md');
        stagedSkillPath = join(mockState.runtimeRoot, 'skills', 'hapi-agent', 'SKILL.md');
        const executableSuffix = platform() === 'win32' ? '.exe' : '';
        const readyFiles = [
            canonicalSource,
            stagedSkillPath,
            join(mockState.runtimeRoot, 'tools', 'unpacked', `difft${executableSuffix}`),
            join(mockState.runtimeRoot, 'tools', 'unpacked', `rg${executableSuffix}`),
            join(mockState.runtimeRoot, 'tools', 'tunwg', `tunwg${executableSuffix}`)
        ];
        for (const file of readyFiles) {
            mkdirSync(join(file, '..'), { recursive: true });
            writeFileSync(file, file === canonicalSource ? canonicalContent : 'present\n');
        }
        writeFileSync(join(mockState.runtimeRoot, '.runtime-version'), packageJson.version);
        mockState.assets = [{
            relativePath: 'skills/hapi-agent/SKILL.md',
            sourcePath: canonicalSource
        }];
    });

    afterEach(() => {
        rmSync(testRoot, { recursive: true, force: true });
    });

    it('restages corrupt skill bytes despite a current version marker', async () => {
        await ensureRuntimeAssets();

        expect(readFileSync(stagedSkillPath, 'utf-8')).toBe(canonicalContent);
        expect(readdirSync(join(mockState.runtimeRoot, 'skills', 'hapi-agent')))
            .toEqual(['SKILL.md']);
    });
});
