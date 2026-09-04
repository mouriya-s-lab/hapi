import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import { getHappyCliCommand } from '@/utils/spawnHappyCLI';
import { shellJoin } from '@/modules/common/shellQuote';

type HookCommandConfig = {
    matcher?: string;
    hooks: Array<{
        type: 'command';
        command: string;
        /** Per-command timeout in SECONDS (claude's hook schema). */
        timeout?: number;
    }>;
};

// PreToolUse bridges a tool approval to the web and blocks the (synchronous)
// hook until the user answers on their phone — which can take minutes. claude's
// default command-hook timeout is 60s; on timeout the decision is dropped and
// claude falls back to its own permission prompt (which renders in the TUI
// and stalls the chat flow). Give the PreToolUse hook a generous timeout so a
// human has time to respond.
const PRE_TOOL_USE_TIMEOUT_SECONDS = 3600;

type ClaudeSettings = Record<string, unknown>;

type HookSettings = ClaudeSettings & {
    hooksConfig?: {
        enabled?: boolean;
    };
    hooks: {
        SessionStart: HookCommandConfig[];
        UserPromptSubmit?: HookCommandConfig[];
        PreToolUse?: HookCommandConfig[];
    };
};

export type HookSettingsOptions = {
    filenamePrefix: string;
    logLabel: string;
    hooksEnabled?: boolean;
    /**
     * Also forward UserPromptSubmit and PreToolUse hooks. Unlike SessionStart,
     * their payloads carry `permission_mode`, letting HAPI track the mode the
     * user picks inside the interactive TUI (shift+tab). Keep this off for the
     * remote SDK process: these hooks block Claude while the forwarder runs,
     * and remote permission state is owned by the hub/RPC path anyway.
     */
    trackPermissionMode?: boolean;
    /**
     * Register a PreToolUse hook (PTY mode only). The SDK path routes tool
     * approvals through the SDK's canUseTool callback, so it must NOT register
     * PreToolUse or every tool would be double-handled. PTY sessions have no
     * SDK callback, so they rely on this hook to bridge tool approvals to the
     * web. The same forwarder command serves both events; it branches on the
     * stdin `hook_event_name`.
     */
    includePreToolUse?: boolean;
};

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

export function buildHookSettings(
    machineSettings: ClaudeSettings,
    command: string,
    hooksEnabled?: boolean,
    trackPermissionMode?: boolean,
    includePreToolUse?: boolean
): HookSettings {
    const commandHook = {
        hooks: [
            {
                type: 'command' as const,
                command
            }
        ]
    };
    const existingHooks = asRecord(machineSettings.hooks);
    const existingSessionStart = Array.isArray(existingHooks.SessionStart)
        ? existingHooks.SessionStart
        : [];
    const hooks: HookSettings['hooks'] = {
        ...existingHooks,
        SessionStart: [
            ...existingSessionStart,
            { matcher: '*', ...commandHook }
        ]
    };
    if (trackPermissionMode) {
        hooks.UserPromptSubmit = [commandHook];
        hooks.PreToolUse = [{ matcher: '*', ...commandHook }];
    }

    if (includePreToolUse) {
        // matcher '*' matches every tool name (claude's matcher: !q || q==='*' → all).
        // The same forwarder command serves both events; it branches on the
        // stdin hook_event_name. The long timeout keeps the (blocking) hook
        // alive while the user approves on their phone.
        hooks.PreToolUse = [
            {
                matcher: '*',
                hooks: [{ type: 'command', command, timeout: PRE_TOOL_USE_TIMEOUT_SECONDS }]
            }
        ];
    }

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
        '--flavor', 'claude',
        '--port',
        String(port),
        '--token',
        token
    ]);
    const hookCommand = shellJoin([command, ...args]);

    const settings = buildHookSettings(
        readMachineClaudeSettings(),
        hookCommand,
        options.hooksEnabled,
        options.trackPermissionMode,
        options.includePreToolUse
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
