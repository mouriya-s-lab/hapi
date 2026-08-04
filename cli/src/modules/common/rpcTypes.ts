import type { AgentFlavor, ClaudeLaunch } from '@hapi/protocol'

export interface SpawnSessionOptions {
    machineId?: string
    directory: string
    sessionId?: string
    existingSessionId?: string
    resumeSessionId?: string
    approvedNewDirectoryCreation?: boolean
    agent?: AgentFlavor
    model?: string
    effort?: string
    modelReasoningEffort?: string
    yolo?: boolean
    permissionMode?: string
    serviceTier?: string
    collaborationMode?: 'default' | 'plan'
    token?: string
    sessionType?: 'simple' | 'worktree'
    worktreeName?: string
    /** Claude: spawn with --fork-session after --resume. */
    forkSession?: boolean
    claudeLaunch?: ClaudeLaunch
    ccSwitchProviderId?: string
}

export type SpawnSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | { type: 'error'; errorMessage: string }
