import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    createOmpLocalSessionScanner,
    resolveOmpSessionPath,
    resolveOmpSessionsDirectory,
    resolveOmpTerminalSessionsDirectory
} from './ompSessionScanner';

const roots: string[] = [];

async function testRoot(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hapi-omp-scanner-'));
    roots.push(root);
    return root;
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('OMP local native session scanner', () => {
    it('mirrors OMP default, override, and XDG session roots', async () => {
        const root = await testRoot();
        expect(resolveOmpSessionsDirectory({
            env: {},
            homeDirectory: root,
            platform: 'darwin'
        })).toBe(path.join(root, '.omp', 'agent', 'sessions'));
        expect(resolveOmpSessionsDirectory({
            env: { PI_CODING_AGENT_DIR: path.join(root, 'custom-agent') },
            homeDirectory: root,
            platform: 'darwin'
        })).toBe(path.join(root, 'custom-agent', 'sessions'));

        const xdg = path.join(root, 'xdg', 'omp');
        await mkdir(xdg, { recursive: true });
        expect(resolveOmpSessionsDirectory({
            env: { XDG_DATA_HOME: path.join(root, 'xdg') },
            homeDirectory: root,
            platform: 'darwin'
        })).toBe(path.join(xdg, 'sessions'));
        expect(resolveOmpSessionsDirectory({
            env: {
                OMP_PROFILE: '',
                PI_PROFILE: 'work',
                PI_CODING_AGENT_DIR: path.join(root, '.omp', 'profiles', 'work', 'agent')
            },
            homeDirectory: root,
            platform: 'darwin'
        })).toBe(path.join(root, '.omp', 'agent', 'sessions'));
    });

    it('ignores a pre-existing resume breadcrumb until OMP rewrites it', async () => {
        const root = await testRoot();
        const cwd = path.join(root, 'work');
        const sessionFile = path.join(root, 'sessions', 'stamp_resume-id.jsonl');
        const terminalDirectory = resolveOmpTerminalSessionsDirectory({
            env: {},
            homeDirectory: root,
            platform: 'darwin'
        });
        await mkdir(cwd, { recursive: true });
        await mkdir(path.dirname(sessionFile), { recursive: true });
        await mkdir(terminalDirectory, { recursive: true });
        await writeFile(sessionFile, `${JSON.stringify({
            type: 'session',
            id: 'resume-id',
            cwd,
            timestamp: new Date().toISOString()
        })}\n`);
        const breadcrumb = path.join(terminalDirectory, 'ttys-test');
        const breadcrumbContent = `${cwd}\n${sessionFile}\n`;
        await writeFile(breadcrumb, breadcrumbContent);
        const onSnapshot = vi.fn();
        const scanner = createOmpLocalSessionScanner({
            workingDirectory: cwd,
            homeDirectory: root,
            platform: 'darwin',
            terminalId: 'ttys-test',
            pollIntervalMs: 60_000,
            onSnapshot
        });
        await scanner.start();
        await scanner.refresh();
        expect(onSnapshot).not.toHaveBeenCalled();

        await writeFile(breadcrumb, breadcrumbContent);
        await scanner.refresh();
        expect(onSnapshot).toHaveBeenCalledOnce();
        expect(onSnapshot).toHaveBeenCalledWith({
            id: 'resume-id',
            file: sessionFile
        });
        await scanner.cleanup();
    });

    it('discovers a fresh lazy session from the terminal breadcrumb before its file exists', async () => {
        const root = await testRoot();
        const cwd = path.join(root, 'work');
        const terminalDirectory = resolveOmpTerminalSessionsDirectory({
            env: {},
            homeDirectory: root,
            platform: 'darwin'
        });
        await mkdir(cwd, { recursive: true });
        await mkdir(terminalDirectory, { recursive: true });
        const onSnapshot = vi.fn();
        const scanner = createOmpLocalSessionScanner({
            workingDirectory: cwd,
            homeDirectory: root,
            platform: 'darwin',
            terminalId: 'ttys-fresh',
            pollIntervalMs: 60_000,
            onSnapshot
        });
        await scanner.start();

        const sessionFile = path.join(root, 'sessions', 'stamp_fresh-id.jsonl');
        await writeFile(path.join(terminalDirectory, 'ttys-fresh'), `${cwd}\n${sessionFile}\n`);
        await scanner.refresh();

        expect(onSnapshot).toHaveBeenCalledWith({ id: 'fresh-id', file: sessionFile });
        await scanner.cleanup();
    });

    it('refreshes the native name when OMP rewrites the active title slot', async () => {
        const root = await testRoot();
        const cwd = path.join(root, 'work');
        const sessionFile = path.join(root, 'sessions', 'stamp_named-id.jsonl');
        const terminalDirectory = resolveOmpTerminalSessionsDirectory({
            env: {},
            homeDirectory: root,
            platform: 'darwin'
        });
        await mkdir(cwd, { recursive: true });
        await mkdir(path.dirname(sessionFile), { recursive: true });
        await mkdir(terminalDirectory, { recursive: true });
        const writeSession = (name: string) => writeFile(sessionFile, [
            JSON.stringify({ type: 'title', title: name }),
            JSON.stringify({ type: 'session', id: 'named-id', cwd, timestamp: new Date().toISOString() }),
            ''
        ].join('\n'));
        await writeSession('First name');
        const onSnapshot = vi.fn();
        const scanner = createOmpLocalSessionScanner({
            workingDirectory: cwd,
            homeDirectory: root,
            platform: 'darwin',
            terminalId: 'ttys-name',
            pollIntervalMs: 60_000,
            onSnapshot
        });
        await scanner.start();
        await writeFile(path.join(terminalDirectory, 'ttys-name'), `${cwd}\n${sessionFile}\n`);
        await scanner.refresh();
        expect(onSnapshot).toHaveBeenLastCalledWith({ id: 'named-id', file: sessionFile, name: 'First name' });

        await writeSession('Second name');
        await scanner.refresh();
        expect(onSnapshot).toHaveBeenLastCalledWith({ id: 'named-id', file: sessionFile, name: 'Second name' });
        await scanner.cleanup();
    });

    it('treats an empty title slot as authoritative over a legacy header title', async () => {
        const root = await testRoot();
        const cwd = path.join(root, 'work');
        const sessionFile = path.join(root, 'sessions', 'stamp_untitled-id.jsonl');
        const terminalDirectory = resolveOmpTerminalSessionsDirectory({
            env: {},
            homeDirectory: root,
            platform: 'darwin'
        });
        await mkdir(cwd, { recursive: true });
        await mkdir(path.dirname(sessionFile), { recursive: true });
        await mkdir(terminalDirectory, { recursive: true });
        await writeFile(sessionFile, [
            JSON.stringify({ type: 'title', v: 1, title: '', updatedAt: new Date().toISOString(), pad: '' }),
            JSON.stringify({ type: 'session', id: 'untitled-id', cwd, title: 'Stale legacy title' }),
            ''
        ].join('\n'));
        const onSnapshot = vi.fn();
        const scanner = createOmpLocalSessionScanner({
            workingDirectory: cwd,
            homeDirectory: root,
            platform: 'darwin',
            terminalId: 'ttys-empty-title',
            pollIntervalMs: 60_000,
            onSnapshot
        });
        await scanner.start();
        await writeFile(path.join(terminalDirectory, 'ttys-empty-title'), `${cwd}\n${sessionFile}\n`);
        await scanner.refresh();

        expect(onSnapshot).toHaveBeenCalledWith({ id: 'untitled-id', file: sessionFile });
        await scanner.cleanup();
    });

    it('resolves /resume like OMP: local cwd first, then global fallback', async () => {
        const root = await testRoot();
        const cwd = path.join(root, 'work');
        const otherCwd = path.join(root, 'other');
        const sessionsRoot = resolveOmpSessionsDirectory({
            env: {},
            homeDirectory: root,
            platform: 'darwin'
        });
        const localFile = path.join(sessionsRoot, 'local-project', 'stamp_shared-prefix-local.jsonl');
        const globalFile = path.join(sessionsRoot, 'other-project', 'stamp_shared-prefix-global.jsonl');
        await mkdir(path.dirname(localFile), { recursive: true });
        await mkdir(path.dirname(globalFile), { recursive: true });
        await writeFile(localFile, `${JSON.stringify({
            type: 'session', id: 'shared-prefix-local', cwd
        })}\n`);
        await writeFile(globalFile, `${JSON.stringify({
            type: 'session', id: 'shared-prefix-global', cwd: otherCwd
        })}\n`);

        const options = { env: {}, homeDirectory: root, platform: 'darwin' as const };
        await expect(resolveOmpSessionPath('shared-prefix', cwd, options)).resolves.toBe(localFile);
        await expect(resolveOmpSessionPath('shared-prefix-g', cwd, options)).resolves.toBe(globalFile);
        await expect(resolveOmpSessionPath('missing', cwd, options)).resolves.toBeNull();
    });
});
