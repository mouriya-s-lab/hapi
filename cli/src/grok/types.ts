import type { GrokPermissionMode } from '@hapi/protocol/types';

export type PermissionMode = GrokPermissionMode;

export interface GrokMode {
    permissionMode: PermissionMode;
    model?: string;
    modelReasoningEffort?: string | null;
}
