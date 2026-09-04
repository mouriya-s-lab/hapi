import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { arch, platform } from 'node:os';
import * as tar from 'tar';
import packageJson from '../../package.json';
import type { EmbeddedAsset } from '#embedded-assets';
import { isBunCompiled, runtimePath } from '@/projectPath';

const RUNTIME_MARKER = '.runtime-version';

function ensureDirectory(path: string): void {
    mkdirSync(path, { recursive: true });
}

const bunRuntime = (globalThis as typeof globalThis & {
    Bun?: { file: (source: string | URL) => { arrayBuffer: () => Promise<ArrayBuffer> } };
}).Bun;

async function readAssetBytes(asset: EmbeddedAsset): Promise<Buffer> {
    if (bunRuntime) {
        return Buffer.from(await bunRuntime.file(asset.sourcePath).arrayBuffer());
    }
    return readFileSync(asset.sourcePath);
}

async function copyAssetFile(asset: EmbeddedAsset, targetPath: string): Promise<void> {
    ensureDirectory(dirname(targetPath));
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    try {
        writeFileSync(tempPath, await readAssetBytes(asset));
        if (!bunRuntime) {
            const stats = statSync(asset.sourcePath);
            chmodSync(tempPath, stats.mode);
        }
        renameSync(tempPath, targetPath);
    } catch (error) {
        rmSync(tempPath, { force: true });
        throw error;
    }
}

function getPlatformDir(): string {
    const platformName = platform();
    const archName = arch();

    if (platformName === 'darwin') {
        if (archName === 'arm64') return 'arm64-darwin';
        if (archName === 'x64') return 'x64-darwin';
    } else if (platformName === 'linux') {
        if (archName === 'arm64') return 'arm64-linux';
        if (archName === 'x64') return 'x64-linux';
    } else if (platformName === 'win32') {
        if (archName === 'x64') return 'x64-win32';
    }

    throw new Error(`Unsupported platform: ${archName}-${platformName}`);
}

function areToolsUnpacked(unpackedPath: string): boolean {
    if (!existsSync(unpackedPath)) {
        return false;
    }

    const isWin = platform() === 'win32';
    const difftBinary = isWin ? 'difft.exe' : 'difft';
    const rgBinary = isWin ? 'rg.exe' : 'rg';

    const expectedFiles = [
        join(unpackedPath, difftBinary),
        join(unpackedPath, rgBinary)
    ];

    return expectedFiles.every((file) => existsSync(file));
}

function isTunwgReady(runtimeRoot: string): boolean {
    const isWin = platform() === 'win32';
    const tunwgBinary = isWin ? 'tunwg.exe' : 'tunwg';
    const tunwgPath = join(runtimeRoot, 'tools', 'tunwg', tunwgBinary);
    return existsSync(tunwgPath);
}

function ensureTunwgExecutable(runtimeRoot: string): void {
    if (platform() === 'win32') {
        return;
    }

    const tunwgPath = join(runtimeRoot, 'tools', 'tunwg', 'tunwg');
    if (existsSync(tunwgPath)) {
        chmodSync(tunwgPath, 0o755);
    }
}

function unpackTools(runtimeRoot: string): void {
    const platformDir = getPlatformDir();
    const toolsDir = join(runtimeRoot, 'tools');
    const archivesDir = join(toolsDir, 'archives');
    const unpackedPath = join(toolsDir, 'unpacked');

    if (areToolsUnpacked(unpackedPath)) {
        return;
    }

    rmSync(unpackedPath, { recursive: true, force: true });
    ensureDirectory(unpackedPath);

    const archives = [
        `difftastic-${platformDir}.tar.gz`,
        `ripgrep-${platformDir}.tar.gz`
    ];

    for (const archiveName of archives) {
        const archivePath = join(archivesDir, archiveName);
        if (!existsSync(archivePath)) {
            throw new Error(`Archive not found: ${archivePath}`);
        }
        tar.extract({
            file: archivePath,
            cwd: unpackedPath,
            sync: true,
            preserveOwner: false
        });
    }

    if (platform() !== 'win32') {
        const files = readdirSync(unpackedPath);
        for (const file of files) {
            if (file.endsWith('.node')) {
                continue;
            }
            const filePath = join(unpackedPath, file);
            const stats = statSync(filePath);
            if (stats.isFile()) {
                chmodSync(filePath, 0o755);
            }
        }
    }
}

const HAPI_AGENT_SKILL_ASSET = 'skills/hapi-agent/SKILL.md';

async function isCanonicalSkillStaged(runtimeRoot: string, embeddedAssets: EmbeddedAsset[]): Promise<boolean> {
    const asset = embeddedAssets.find((candidate) => candidate.relativePath === HAPI_AGENT_SKILL_ASSET);
    if (!asset) {
        return false;
    }
    try {
        return readFileSync(join(runtimeRoot, asset.relativePath)).equals(await readAssetBytes(asset));
    } catch {
        return false;
    }
}

async function runtimeAssetsReady(runtimeRoot: string, embeddedAssets: EmbeddedAsset[]): Promise<boolean> {
    return areToolsUnpacked(join(runtimeRoot, 'tools', 'unpacked'))
        && isTunwgReady(runtimeRoot)
        && await isCanonicalSkillStaged(runtimeRoot, embeddedAssets);
}

export async function ensureRuntimeAssets(): Promise<void> {
    if (!isBunCompiled()) {
        return;
    }

    const { loadEmbeddedAssets } = await import('#embedded-assets');
    const embeddedAssets = await loadEmbeddedAssets();
    const runtimeRoot = runtimePath();
    const markerPath = join(runtimeRoot, RUNTIME_MARKER);
    if (existsSync(markerPath)) {
        const markerVersion = readFileSync(markerPath, 'utf-8').trim();
        if (markerVersion === packageJson.version && await runtimeAssetsReady(runtimeRoot, embeddedAssets)) {
            return;
        }
    }

    ensureDirectory(runtimeRoot);


    for (const asset of embeddedAssets) {
        const targetPath = join(runtimeRoot, asset.relativePath);
        await copyAssetFile(asset, targetPath);
    }

    unpackTools(runtimeRoot);
    ensureTunwgExecutable(runtimeRoot);
    if (!await isCanonicalSkillStaged(runtimeRoot, embeddedAssets)) {
        throw new Error('Embedded hapi-agent skill failed canonical staging verification');
    }
    writeFileSync(markerPath, packageJson.version, 'utf-8');
}

export function getTunwgPath(): string {
    const isWin = platform() === 'win32';
    const tunwgBinary = isWin ? 'tunwg.exe' : 'tunwg';

    if (isBunCompiled()) {
        return join(runtimePath(), 'tools', 'tunwg', tunwgBinary);
    }

    // Development mode: use downloaded binary from shared/tools/tunwg
    const platformDir = getPlatformDir();
    const devBinaryName = isWin ? `tunwg-${platformDir}.exe` : `tunwg-${platformDir}`;
    return join(__dirname, '..', '..', '..', 'shared', 'tools', 'tunwg', devBinaryName);
}
