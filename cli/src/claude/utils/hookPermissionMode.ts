import { isPermissionModeAllowedForFlavor } from '@hapi/protocol';
import { PermissionModeSchema } from '@hapi/protocol/schemas';
import type { PermissionMode } from '../loop';

/**
 * Normalize the `permission_mode` field from a Claude Code hook payload
 * (UserPromptSubmit / PreToolUse) into a HAPI Claude permission mode.
 *
 * Claude 2.1.x calls the base mode `manual` in some surfaces; HAPI calls it
 * `default`. Modes HAPI has no equivalent for (e.g. `dontAsk`) return null and
 * are ignored by the caller.
 */
export function normalizeHookPermissionMode(value: unknown): PermissionMode | null {
    if (typeof value !== 'string') {
        return null;
    }
    const mapped = value === 'manual' ? 'default' : value;
    const parsed = PermissionModeSchema.safeParse(mapped);
    if (!parsed.success || !isPermissionModeAllowedForFlavor(parsed.data, 'claude')) {
        return null;
    }
    return parsed.data as PermissionMode;
}
