import type { OmpPermissionMode } from '@hapi/protocol/types';

export type PermissionMode = OmpPermissionMode;

export interface OmpMode {
    permissionMode: PermissionMode;
    model?: string;
}
