import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import { getHappyCliCommand } from '@/utils/spawnHappyCLI';

type HookCommandConfig = {
    matcher: string;
    hooks: Array<{
        type: 'command';
        command: string;
    }>;
};

type ClaudeSettings = Record<string, unknown>;

type HookSettings = ClaudeSettings & {
    hooksConfig?: {
        enabled?: boolean;
    };
    hooks: {
        SessionStart: HookCommandConfig[];
    };
};

export type HookSettingsOptions = {
    filenamePrefix: string;
    logLabel: string;
    hooksEnabled?: boolean;
};

function shellQuote(value: string): string {
    if (value.length === 0) {
        return '""';
    }

    if (/^[A-Za-z0-9_\/:=-]+$/.test(value)) {
        return value;
    }

    return '"' + value.replace(/(["\\$`])/g, '\\$1') + '"';
}

function shellJoin(parts: string[]): string {
    return parts.map(shellQuote).join(' ');
}

function readMachineClaudeSettings(): ClaudeSettings {
    const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const settingsPath = join(configDir, 'settings.json');

    if (!existsSync(settingsPath)) {
        return {};
    }

    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Claude settings must be a JSON object: ${settingsPath}`);
    }

    return parsed as ClaudeSettings;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function buildHookSettings(
    machineSettings: ClaudeSettings,
    command: string,
    hooksEnabled?: boolean
): HookSettings {
    const existingHooks = asRecord(machineSettings.hooks);
    const existingSessionStart = Array.isArray(existingHooks.SessionStart)
        ? existingHooks.SessionStart
        : [];
    const hooks: HookSettings['hooks'] = {
        ...existingHooks,
        SessionStart: [
            ...existingSessionStart,
            {
                matcher: '*',
                hooks: [
                    {
                        type: 'command',
                        command
                    }
                ]
            }
        ]
    };

    const settings: HookSettings = {
        ...machineSettings,
        hooks
    };
    if (hooksEnabled !== undefined) {
        settings.hooksConfig = {
            ...asRecord(machineSettings.hooksConfig),
            enabled: hooksEnabled
        };
    }

    return settings;
}

export function generateHookSettingsFile(
    port: number,
    token: string,
    options: HookSettingsOptions
): string {
    const hooksDir = join(configuration.happyHomeDir, 'tmp', 'hooks');
    mkdirSync(hooksDir, { recursive: true });

    const filename = `${options.filenamePrefix}-${process.pid}.json`;
    const filepath = join(hooksDir, filename);

    const { command, args } = getHappyCliCommand([
        'hook-forwarder',
        '--port',
        String(port),
        '--token',
        token
    ]);
    const hookCommand = shellJoin([command, ...args]);

    const settings = buildHookSettings(
        readMachineClaudeSettings(),
        hookCommand,
        options.hooksEnabled
    );

    writeFileSync(filepath, JSON.stringify(settings, null, 4));
    logger.debug(`[${options.logLabel}] Created hook settings file: ${filepath}`);

    return filepath;
}

export function cleanupHookSettingsFile(filepath: string, logLabel: string): void {
    try {
        if (existsSync(filepath)) {
            unlinkSync(filepath);
            logger.debug(`[${logLabel}] Cleaned up hook settings file: ${filepath}`);
        }
    } catch (error) {
        logger.debug(`[${logLabel}] Failed to cleanup hook settings file: ${error}`);
    }
}
