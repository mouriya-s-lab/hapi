import type { AgentType } from './types'

type OpencodeModelDiscoveryAgent = Extract<AgentType, 'opencode' | 'omp'>

export function isOpencodeModelDiscoveryAgent(agent: AgentType): agent is OpencodeModelDiscoveryAgent {
    return agent === 'opencode' || agent === 'omp'
}

/**
 * Decide whether the new-session form should fire OpenCode model discovery
 * for the current input state.
 *
 * Discovery is gated on the cwd having been *positively* confirmed to exist
 * on the target machine. While `cwdExists` is undefined (existence probe in
 * flight) or false (typing through a partial path), we suppress discovery so
 * the CLI does not spawn an ACP subprocess for a non-existent directory only
 * to time out 30 seconds later.
 */
export function shouldEnableOpencodeModelDiscovery(args: {
    agent: AgentType
    machineId: string | null
    cwd: string
    cwdExists: boolean | undefined
}): boolean {
    if (!isOpencodeModelDiscoveryAgent(args.agent)) return false
    if (!args.machineId) return false
    if (args.cwd.length === 0) return false
    return args.cwdExists === true
}
