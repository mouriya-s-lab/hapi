import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@/ui/logger';

export const GROK_MODEL_ENV = 'GROK_MODEL';

export type GrokLocalConfig = {
    model?: string;
};

export type GrokModelSource = 'explicit' | 'env' | 'local' | 'default';

const GROK_DIR = join(homedir(), '.grok');
const CONFIG_PATH = join(GROK_DIR, 'config.toml');

function readTomlFile(path: string): string | null {
    if (!existsSync(path)) {
        return null;
    }

    try {
        return readFileSync(path, 'utf-8');
    } catch (error) {
        logger.debug(`[grok-config] Failed to read ${path}:`, error);
    }

    return null;
}

export function parseGrokConfiguredModel(config: string): string | undefined {
    let section: string | null = null;
    for (const line of config.split('\n')) {
        const trimmed = line.trim();
        const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            section = sectionMatch[1];
            continue;
        }
        if (section !== 'models') continue;
        const defaultMatch = trimmed.match(/^default\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/);
        if (defaultMatch) return defaultMatch[1].trim();
    }
    return undefined;
}

export function readGrokLocalConfig(): GrokLocalConfig {
    const configFile = readTomlFile(CONFIG_PATH);

    return {
        model: configFile ? parseGrokConfiguredModel(configFile) : undefined
    };
}

export function resolveGrokRuntimeConfig(opts: {
    model?: string;
} = {}): { model: string | undefined; modelSource: GrokModelSource } {
    const local = readGrokLocalConfig();

    let modelSource: GrokModelSource = 'default';
    let model: string | undefined;

    if (opts.model) {
        model = opts.model;
        modelSource = 'explicit';
    } else if (process.env[GROK_MODEL_ENV]) {
        model = process.env[GROK_MODEL_ENV]!;
        modelSource = 'env';
    } else if (local.model) {
        model = local.model;
        modelSource = 'local';
    }

    return { model, modelSource };
}

export function buildGrokEnv(opts: {
    model?: string;
    cwd?: string;
}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        ...process.env
    };

    if (opts.model) env[GROK_MODEL_ENV] = opts.model;

    return env;
}
