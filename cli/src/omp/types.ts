import type { OmpPermissionMode } from '@hapi/protocol/types';
import type { OmpConfiguredThinkingLevel } from '@hapi/protocol/omp';

export type PermissionMode = OmpPermissionMode;

export interface OmpMode {
    permissionMode: PermissionMode;
    // `string` is a specific model id; `null` means "reset to the model omp
    // launched with" (e.g. after `/model default`); `undefined` means "no change
    // requested for this batch".
    model?: string | null;
    /** Durable OMP thinking selector; `auto` remains distinct from its resolution. */
    effort?: OmpConfiguredThinkingLevel;
}
