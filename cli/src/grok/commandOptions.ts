import { GROK_PERMISSION_MODES } from '@hapi/protocol/modes';
import { parseRemoteAgentCommandOptions } from '@/commands/agentCommandOptions';
import type { PermissionMode } from './types';

export function parseGrokCommandOptions(args: string[]): ReturnType<typeof parseRemoteAgentCommandOptions<PermissionMode>> {
    const options = parseRemoteAgentCommandOptions(args, GROK_PERMISSION_MODES);
    if (options.effort !== undefined) {
        options.modelReasoningEffort = options.effort;
        delete options.effort;
    }
    return options;
}
