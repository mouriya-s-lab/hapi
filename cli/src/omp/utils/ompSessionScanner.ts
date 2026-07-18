import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { open, readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { OmpNativeSession } from '@hapi/protocol/types';
import { logger } from '@/ui/logger';

const DEFAULT_POLL_INTERVAL_MS = 100;
const SESSION_HEADER_BYTES = 16 * 1024;

type OmpDirectoryCategory = 'data' | 'state';

export type OmpLocalSessionScannerOptions = {
    workingDirectory: string;
    onSnapshot: (snapshot: OmpNativeSession) => void;
    env?: NodeJS.ProcessEnv;
    homeDirectory?: string;
    platform?: NodeJS.Platform;
    terminalId?: string | null;
    pollIntervalMs?: number;
};

export type OmpLocalSessionScanner = {
    start: () => Promise<void>;
    refresh: () => Promise<void>;
    cleanup: () => Promise<void>;
};

type ParsedSessionHeader = {
    id: string;
    cwd: string;
    name?: string;
};

type ResumableSessionCandidate = ParsedSessionHeader & {
    file: string;
    modifiedMs: number;
};

function normalizedProfile(raw: string | undefined): string | undefined {
    const value = raw?.trim();
    if (!value || value === 'default') {
        return undefined;
    }
    if (
        !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)
        || value === '.'
        || value === '..'
        || value.endsWith('.')
        || /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/i.test(value)
    ) {
        return undefined;
    }
    return value;
}

function activeProfile(env: NodeJS.ProcessEnv): string | undefined {
    const raw = env.OMP_PROFILE !== undefined ? env.OMP_PROFILE : env.PI_PROFILE;
    return normalizedProfile(raw);
}

function configRoot(homeDirectory: string, env: NodeJS.ProcessEnv, profile: string | undefined): string {
    const root = path.join(homeDirectory, env.PI_CONFIG_DIR || '.omp');
    return profile ? path.join(root, 'profiles', profile) : root;
}

export function resolveOmpAgentCategoryDirectory(
    category: OmpDirectoryCategory,
    options: {
        env?: NodeJS.ProcessEnv;
        homeDirectory?: string;
        platform?: NodeJS.Platform;
    } = {}
): string {
    const env = options.env ?? process.env;
    const homeDirectory = options.homeDirectory ?? os.homedir();
    const platform = options.platform ?? process.platform;
    const profile = activeProfile(env);
    const root = configRoot(homeDirectory, env, profile);
    const defaultAgentDirectory = path.join(root, 'agent');
    const lowerPriorityProfile = profile ? undefined : normalizedProfile(env.PI_PROFILE);
    const profileDerivedAgentDirectory = lowerPriorityProfile
        ? path.join(configRoot(homeDirectory, env, lowerPriorityProfile), 'agent')
        : undefined;
    const agentDirectory = !profile
        && env.PI_CODING_AGENT_DIR
        && env.PI_CODING_AGENT_DIR !== profileDerivedAgentDirectory
        ? path.resolve(env.PI_CODING_AGENT_DIR)
        : defaultAgentDirectory;

    const xdgVariable = category === 'data' ? 'XDG_DATA_HOME' : 'XDG_STATE_HOME';
    const xdgBase = env[xdgVariable];
    if ((platform === 'linux' || platform === 'darwin') && agentDirectory === defaultAgentDirectory && xdgBase) {
        const appRoot = path.join(xdgBase, 'omp');
        const candidate = profile ? path.join(appRoot, 'profiles', profile) : appRoot;
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    return agentDirectory;
}

export function resolveOmpSessionsDirectory(
    options: Parameters<typeof resolveOmpAgentCategoryDirectory>[1] = {}
): string {
    return path.join(resolveOmpAgentCategoryDirectory('data', options), 'sessions');
}

export function resolveOmpTerminalSessionsDirectory(
    options: Parameters<typeof resolveOmpAgentCategoryDirectory>[1] = {}
): string {
    return path.join(resolveOmpAgentCategoryDirectory('state', options), 'terminal-sessions');
}

function canonicalPath(value: string): string {
    const resolved = path.resolve(value);
    try {
        return realpathSync(resolved);
    } catch {
        return resolved;
    }
}

function samePath(left: string, right: string): boolean {
    const canonicalLeft = canonicalPath(left);
    const canonicalRight = canonicalPath(right);
    return process.platform === 'win32'
        ? canonicalLeft.toLowerCase() === canonicalRight.toLowerCase()
        : canonicalLeft === canonicalRight;
}

function terminalIdFromEnvironment(env: NodeJS.ProcessEnv): string | null {
    if (env.ZELLIJ_PANE_ID) {
        const session = env.ZELLIJ_SESSION_NAME?.replace(/[\\/]/g, '-');
        return session
            ? `zellij-${session}-${env.ZELLIJ_PANE_ID}`
            : `zellij-${env.ZELLIJ_PANE_ID}`;
    }
    const candidates: Array<[string, string | undefined]> = [
        ['tmux', env.TMUX_PANE],
        ['cmux', env.CMUX_SURFACE_ID],
        ['kitty', env.KITTY_WINDOW_ID],
        ['wezterm', env.WEZTERM_PANE],
        ['apple', env.TERM_SESSION_ID],
        ['wt', env.WT_SESSION]
    ];
    for (const [prefix, value] of candidates) {
        if (value) {
            return `${prefix}-${value.replace(/[\\/]/g, '-')}`;
        }
    }
    return null;
}

export function resolveCurrentTerminalId(env: NodeJS.ProcessEnv = process.env): string | null {
    if (process.stdin.isTTY) {
        try {
            const ttyPath = execFileSync('tty', {
                encoding: 'utf8',
                stdio: ['inherit', 'pipe', 'ignore']
            }).trim();
            if (ttyPath.startsWith('/dev/')) {
                return ttyPath.slice('/dev/'.length).replace(/\//g, '-');
            }
        } catch {
        }
    }
    return terminalIdFromEnvironment(env);
}

async function fileRevision(filePath: string): Promise<string | null> {
    try {
        const value = await stat(filePath, { bigint: true });
        return `${value.dev}:${value.ino}:${value.size}:${value.mtimeNs}`;
    } catch {
        return null;
    }
}

function parseSessionIdFromFile(filePath: string): string | null {
    const name = path.basename(filePath);
    if (!name.endsWith('.jsonl')) {
        return null;
    }
    const stem = name.slice(0, -'.jsonl'.length);
    const separator = stem.lastIndexOf('_');
    const id = separator >= 0 ? stem.slice(separator + 1) : stem;
    return id.trim() || null;
}

async function readPrefix(filePath: string): Promise<string | null> {
    let handle;
    try {
        handle = await open(filePath, 'r');
        const buffer = Buffer.allocUnsafe(SESSION_HEADER_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead).toString('utf8');
    } catch {
        return null;
    } finally {
        await handle?.close().catch(() => undefined);
    }
}

function parseSessionHeader(prefix: string): ParsedSessionHeader | null {
    let titleSlotSeen = false;
    let title: string | undefined;
    for (const line of prefix.split(/\r?\n/)) {
        if (!line.trim()) {
            continue;
        }
        let value: unknown;
        try {
            value = JSON.parse(line);
        } catch {
            return null;
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }
        const record = value as Record<string, unknown>;
        if (record.type === 'title') {
            titleSlotSeen = true;
            const candidate = typeof record.title === 'string' ? record.title.trim() : '';
            title = candidate || undefined;
            continue;
        }
        if (record.type !== 'session' || typeof record.id !== 'string' || typeof record.cwd !== 'string') {
            return null;
        }
        const headerTitle = typeof record.title === 'string' ? record.title.trim() : '';
        const name = titleSlotSeen ? title : (headerTitle || undefined);
        return {
            id: record.id,
            cwd: record.cwd,
            ...(name ? { name } : {})
        };
    }
    return null;
}

async function listOmpSessionFiles(sessionsRoot: string): Promise<string[]> {
    const projectDirectories = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
    const files = await Promise.all(projectDirectories
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
            const directory = path.join(sessionsRoot, entry.name);
            const children = await readdir(directory, { withFileTypes: true }).catch(() => []);
            return children
                .filter((child) => child.isFile() && child.name.endsWith('.jsonl'))
                .map((child) => path.join(directory, child.name));
        }));
    return files.flat();
}

async function resumableSessionCandidate(file: string): Promise<ResumableSessionCandidate | null> {
    const [prefix, fileStat] = await Promise.all([
        readPrefix(file),
        stat(file).catch(() => null)
    ]);
    if (prefix === null || fileStat === null) {
        return null;
    }
    const header = parseSessionHeader(prefix);
    return header ? {
        ...header,
        file,
        modifiedMs: fileStat.mtimeMs
    } : null;
}

function matchesResumeArgument(candidate: ResumableSessionCandidate, sessionArg: string): boolean {
    const normalizedArg = sessionArg.toLowerCase();
    if (candidate.id.toLowerCase().startsWith(normalizedArg)) {
        return true;
    }
    const fileName = path.basename(candidate.file, '.jsonl').toLowerCase();
    if (fileName.startsWith(normalizedArg)) {
        return true;
    }
    const separator = fileName.lastIndexOf('_');
    return separator >= 0 && fileName.slice(separator + 1).startsWith(normalizedArg);
}

export async function resolveOmpSessionPath(
    sessionArg: string,
    workingDirectory: string,
    options: {
        env?: NodeJS.ProcessEnv;
        homeDirectory?: string;
        platform?: NodeJS.Platform;
    } = {}
): Promise<string | null> {
    const sessionsRoot = resolveOmpSessionsDirectory(options);
    const candidates: ResumableSessionCandidate[] = [];
    for (const file of await listOmpSessionFiles(sessionsRoot)) {
        const candidate = await resumableSessionCandidate(file);
        if (candidate) {
            candidates.push(candidate);
        }
    }
    candidates.sort((left, right) => right.modifiedMs - left.modifiedMs);
    const localMatch = candidates.find((candidate) => (
        samePath(candidate.cwd, workingDirectory) && matchesResumeArgument(candidate, sessionArg)
    ));
    const match = localMatch ?? candidates.find((candidate) => matchesResumeArgument(candidate, sessionArg));
    return match?.file ?? null;
}

async function snapshotFromSessionFile(
    sessionFile: string,
    expectedCwd: string
): Promise<OmpNativeSession | null> {
    const prefix = await readPrefix(sessionFile);
    if (prefix !== null) {
        const header = parseSessionHeader(prefix);
        if (!header || !samePath(header.cwd, expectedCwd)) {
            return null;
        }
        return {
            id: header.id,
            file: path.resolve(sessionFile),
            ...(header.name ? { name: header.name } : {})
        };
    }

    const id = parseSessionIdFromFile(sessionFile);
    return id ? { id, file: path.resolve(sessionFile) } : null;
}

class OmpLocalSessionScannerImpl implements OmpLocalSessionScanner {
    private readonly env: NodeJS.ProcessEnv;
    private readonly workingDirectory: string;
    private readonly breadcrumbPath: string | null;
    private readonly onSnapshot: (snapshot: OmpNativeSession) => void;
    private readonly pollIntervalMs: number;
    private observedBreadcrumbRevision: string | null = null;
    private activeFileRevision: string | null = null;
    private activeSnapshot: OmpNativeSession | null = null;
    private interval: ReturnType<typeof setInterval> | null = null;
    private scanTail: Promise<void> = Promise.resolve();

    constructor(options: OmpLocalSessionScannerOptions) {
        this.env = options.env ?? process.env;
        this.workingDirectory = canonicalPath(options.workingDirectory);
        this.onSnapshot = options.onSnapshot;
        this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        const terminalId = options.terminalId === undefined
            ? resolveCurrentTerminalId(this.env)
            : options.terminalId;
        const directoryOptions = {
            env: this.env,
            homeDirectory: options.homeDirectory,
            platform: options.platform
        };
        this.breadcrumbPath = terminalId
            ? path.join(resolveOmpTerminalSessionsDirectory(directoryOptions), terminalId)
            : null;
    }

    async start(): Promise<void> {
        if (!this.breadcrumbPath) {
            logger.warn('[omp-session-scanner] Cannot identify the local terminal; native session discovery is disabled');
            return;
        }
        this.observedBreadcrumbRevision = await fileRevision(this.breadcrumbPath);
        this.interval = setInterval(() => {
            void this.refresh();
        }, this.pollIntervalMs);
        this.interval.unref?.();
    }

    refresh(): Promise<void> {
        this.scanTail = this.scanTail.then(() => this.scan()).catch((error) => {
            logger.debug('[omp-session-scanner] Scan failed', error);
        });
        return this.scanTail;
    }

    async cleanup(): Promise<void> {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        await this.refresh();
    }

    private async scan(): Promise<void> {
        if (!this.breadcrumbPath) {
            return;
        }
        const revision = await fileRevision(this.breadcrumbPath);
        if (revision && revision !== this.observedBreadcrumbRevision) {
            this.observedBreadcrumbRevision = revision;
            const content = await readFile(this.breadcrumbPath, 'utf8').catch(() => null);
            if (content) {
                const [cwd, sessionFile] = content.trim().split(/\r?\n/);
                if (cwd && sessionFile && samePath(cwd, this.workingDirectory)) {
                    const snapshot = await snapshotFromSessionFile(sessionFile, this.workingDirectory);
                    if (snapshot) {
                        this.applySnapshot(snapshot);
                    }
                }
            }
        }

        if (!this.activeSnapshot) {
            return;
        }
        const activeRevision = await fileRevision(this.activeSnapshot.file);
        if (activeRevision === this.activeFileRevision) {
            return;
        }
        this.activeFileRevision = activeRevision;
        const refreshed = await snapshotFromSessionFile(
            this.activeSnapshot.file,
            this.workingDirectory
        );
        if (refreshed) {
            this.applySnapshot(refreshed);
        }
    }

    private applySnapshot(snapshot: OmpNativeSession): void {
        const previous = this.activeSnapshot;
        if (
            previous?.id === snapshot.id
            && previous.file === snapshot.file
            && previous.name === snapshot.name
        ) {
            return;
        }
        this.activeSnapshot = snapshot;
        this.onSnapshot(snapshot);
    }
}

export function createOmpLocalSessionScanner(
    options: OmpLocalSessionScannerOptions
): OmpLocalSessionScanner {
    return new OmpLocalSessionScannerImpl(options);
}
