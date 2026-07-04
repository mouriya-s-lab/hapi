import { z } from 'zod'
import {
    AttachmentMetadataSchema,
    CodexCollaborationModeSchema,
    DecryptedMessageSchema,
    MachineSchema,
    PermissionModeSchema,
    SessionSchema
} from './schemas'
import { AgentFlavorSchema } from './modes'
import type {
    DecryptedMessage,
    Machine,
    Session
} from './schemas'
import type { SessionSummary } from './sessionSummary'

export const CreateOrLoadSessionRequestSchema = z.object({
    tag: z.string().min(1),
    metadata: z.unknown(),
    agentState: z.unknown().nullable().optional(),
    model: z.string().optional(),
    modelReasoningEffort: z.string().optional(),
    effort: z.string().optional()
})

export type CreateOrLoadSessionRequest = z.infer<typeof CreateOrLoadSessionRequestSchema>

export const CreateOrLoadMachineRequestSchema = z.object({
    id: z.string().min(1),
    metadata: z.unknown(),
    runnerState: z.unknown().nullable().optional()
})

export type CreateOrLoadMachineRequest = z.infer<typeof CreateOrLoadMachineRequestSchema>

export const CliMessagesResponseSchema = z.object({
    messages: z.array(z.object({
        id: z.string(),
        seq: z.number(),
        createdAt: z.number(),
        localId: z.string().nullable().optional(),
        content: z.unknown()
    }))
})

export type CliMessagesResponse = z.infer<typeof CliMessagesResponseSchema>

export const CreateSessionResponseSchema = z.object({
    session: SessionSchema
})

export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>

export const CreateMachineResponseSchema = z.object({
    machine: MachineSchema
})

export type CreateMachineResponse = z.infer<typeof CreateMachineResponseSchema>

export const GetSessionResponseSchema = CreateSessionResponseSchema
export type GetSessionResponse = CreateSessionResponse

export type AuthResponse = {
    token: string
    user: {
        id: number
        username?: string
        firstName?: string
        lastName?: string
        role?: 'admin' | 'user'
    }
}

export type SessionsResponse = { sessions: SessionSummary[] }
export type SessionResponse = { session: Session }
export type MessagesResponse = {
    messages: DecryptedMessage[]
    page: {
        limit: number
        nextBeforeSeq: number | null
        nextBeforeAt: number | null
        hasMore: boolean
    }
}

export type MachinesResponse = { machines: Machine[] }

export type SpawnResponse =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string }

export const SessionPermissionModeRequestSchema = z.object({
    mode: PermissionModeSchema
})

export type SessionPermissionModeRequest = z.infer<typeof SessionPermissionModeRequestSchema>

export const ResumeSessionRequestSchema = z.object({
    permissionMode: PermissionModeSchema.optional()
})

export type ResumeSessionRequest = z.infer<typeof ResumeSessionRequestSchema>

export const ReopenSessionResponseSchema = z.object({
    ok: z.literal(true),
    sessionId: z.string(),
    resumed: z.boolean(),
    cursorSessionProtocol: z.enum(['acp', 'stream-json']).optional()
})

export type ReopenSessionResponse = z.infer<typeof ReopenSessionResponseSchema>

export const ReopenSessionMissingMetadataResponseSchema = z.object({
    error: z.string(),
    missing: z.array(z.string()).nonempty()
})

export type ReopenSessionMissingMetadataResponse = z.infer<typeof ReopenSessionMissingMetadataResponseSchema>

export const SessionCollaborationModeRequestSchema = z.object({
    mode: CodexCollaborationModeSchema
})

export type SessionCollaborationModeRequest = z.infer<typeof SessionCollaborationModeRequestSchema>

export const SessionModelRequestSchema = z.object({
    model: z.string().trim().min(1).nullable()
})

export type SessionModelRequest = z.infer<typeof SessionModelRequestSchema>

export const SessionModelReasoningEffortRequestSchema = z.object({
    modelReasoningEffort: z.string().trim().min(1).nullable()
})

export type SessionModelReasoningEffortRequest = z.infer<typeof SessionModelReasoningEffortRequestSchema>

export const SessionEffortRequestSchema = z.object({
    effort: z.string().trim().min(1).nullable()
})

export type SessionEffortRequest = z.infer<typeof SessionEffortRequestSchema>

export const RenameSessionRequestSchema = z.object({
    name: z.string().min(1).max(255)
})

export type RenameSessionRequest = z.infer<typeof RenameSessionRequestSchema>

/** Per-session legacy stream-json → ACP migrator request. See tiann/hapi#824. */
export const CursorMigrateToAcpRequestSchema = z.object({
    /** Skip removing the legacy ~/.cursor/chats source store.db even after verify passes. */
    keepSource: z.boolean().optional(),
    /** Allow migrating a session whose lifecycleState === 'running' by archiving it first. */
    forceArchiveRunning: z.boolean().optional(),
    /** Skip the verify-by-prompt step (session/load alone is run). */
    skipVerify: z.boolean().optional()
})

export type CursorMigrateToAcpRequest = z.infer<typeof CursorMigrateToAcpRequestSchema>

export type CursorMigrateOutcome =
    | { ok: true; sessionId: string; acpSessionId: string; replayNotifications: number; durationMs: number; lastUsedModelPreserved: string | null; sourceRemoved: boolean }
    | { ok: false; sessionId: string; reason: CursorMigrateRefusalReason; message: string; durationMs: number }

export type CursorMigrateRefusalReason =
    | 'not_cursor_session'
    | 'already_acp'
    | 'running_refused'
    | 'no_cursor_session_id'
    | 'no_legacy_store_on_disk'
    | 'target_already_exists'
    | 'verify_load_failed'
    | 'verify_prompt_failed'
    | 'metadata_write_failed'
    | 'archive_failed'
    | 'lock_release_timeout'
    | 'acp_transport_active'
    | 'session_resumed_during_migrate'
    | 'legacy_store_modified_during_migrate'
    | 'cross_host_session'
    | 'ambiguous_legacy_store'
    | 'size_mismatch'
    | 'internal_error'

export const UploadFileRequestSchema = z.object({
    filename: z.string().min(1).max(255),
    content: z.string().min(1),
    mimeType: z.string().min(1).max(255)
})

export type UploadFileRequest = z.infer<typeof UploadFileRequestSchema>

export const DeleteUploadRequestSchema = z.object({
    path: z.string().min(1)
})

export type DeleteUploadRequest = z.infer<typeof DeleteUploadRequestSchema>

export const MessagesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    beforeSeq: z.coerce.number().int().min(1).optional(),
    beforeAt: z.coerce.number().int().min(0).optional(),
}).refine((data) => (data.beforeAt === undefined) === (data.beforeSeq === undefined), {
    message: 'beforeAt and beforeSeq must be provided together',
    path: ['beforeAt'],
})

export type MessagesQuery = z.infer<typeof MessagesQuerySchema>

export const SendMessageRequestSchema = z.object({
    text: z.string(),
    localId: z.string().min(1).optional(),
    attachments: z.array(AttachmentMetadataSchema).optional(),
    scheduledAt: z.number().int().positive().nullable().optional()
}).refine(
    (data) => data.scheduledAt == null || typeof data.localId === 'string',
    { message: 'scheduledAt requires localId', path: ['localId'] }
).refine(
    (data) => data.scheduledAt == null || data.scheduledAt <= Date.now() + 7 * 24 * 60 * 60 * 1000,
    { message: 'scheduledAt must be within 7 days from now', path: ['scheduledAt'] }
).refine(
    (data) => data.scheduledAt == null || !data.attachments?.length,
    { message: 'scheduled messages with attachments are not supported', path: ['attachments'] }
)

export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>

export const SpawnSessionRequestSchema = z.object({
    directory: z.string().min(1),
    agent: AgentFlavorSchema.optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
    modelReasoningEffort: z.string().optional(),
    yolo: z.boolean().optional(),
    sessionType: z.enum(['simple', 'worktree']).optional(),
    worktreeName: z.string().optional()
})

export type SpawnSessionRequest = z.infer<typeof SpawnSessionRequestSchema>

export const MachineListDirectoryRequestSchema = z.object({
    path: z.string().min(1)
})

export type MachineListDirectoryRequest = z.infer<typeof MachineListDirectoryRequestSchema>

export const MachinePathsExistsRequestSchema = z.object({
    paths: z.array(z.string().min(1)).max(1000)
})

export type MachinePathsExistsRequest = z.infer<typeof MachinePathsExistsRequestSchema>

export const AuthRequestSchema = z.union([
    z.object({ initData: z.string() }),
    z.object({ accessToken: z.string() }),
    z.object({ username: z.string().min(1), password: z.string().min(1) })
])

export type AuthRequest = z.infer<typeof AuthRequestSchema>

export type AuthUser = {
    id: number
    username?: string
    firstName?: string
    lastName?: string
    role?: 'admin' | 'user'
}

// ---- Multi-user: accounts, API tokens, resource grants ----

export type AccountRole = 'admin' | 'user'

export type AccountSummary = {
    id: number
    username: string
    role: AccountRole
    defaultNamespace: string
    authProvider: string
    hasPassword: boolean
    disabled: boolean
    createdAt: number
    /** Per-user memory prompt the hub prepends to messages this user sends to agents. */
    memory?: string | null
}

export type ApiTokenSummary = {
    id: number
    name: string | null
    namespace: string
    createdAt: number
    lastUsedAt: number | null
    // Plaintext is only present in the create response, shown once.
    token?: string
}

export type ResourceGrantSummary = {
    id: number
    resourceType: 'machine' | 'session'
    resourceId: string
    granteeAccountId: number
    granteeUsername?: string
    role: 'viewer' | 'operator'
    createdAt: number
}

export const CreateAccountRequestSchema = z.object({
    username: z.string().min(1).max(64),
    password: z.string().min(8).max(256).optional(),
    role: z.enum(['admin', 'user']).optional(),
    defaultNamespace: z.string().min(1).max(64).optional()
})
export type CreateAccountRequest = z.infer<typeof CreateAccountRequestSchema>

export const UpdateAccountRequestSchema = z.object({
    role: z.enum(['admin', 'user']).optional(),
    password: z.string().min(8).max(256).optional(),
    disabled: z.boolean().optional(),
    defaultNamespace: z.string().min(1).max(64).optional(),
    memory: z.string().max(4000).nullable().optional()
})
export type UpdateAccountRequest = z.infer<typeof UpdateAccountRequestSchema>

export const UpdateMemoryRequestSchema = z.object({
    memory: z.string().max(4000).nullable()
})
export type UpdateMemoryRequest = z.infer<typeof UpdateMemoryRequestSchema>

export const CreateApiTokenRequestSchema = z.object({
    name: z.string().max(128).optional(),
    namespace: z.string().min(1).max(64).optional()
})
export type CreateApiTokenRequest = z.infer<typeof CreateApiTokenRequestSchema>

export const CreateGrantRequestSchema = z.object({
    resourceType: z.enum(['machine', 'session']),
    resourceId: z.string().min(1),
    granteeUsername: z.string().min(1),
    role: z.enum(['viewer', 'operator'])
})
export type CreateGrantRequest = z.infer<typeof CreateGrantRequestSchema>


export type CommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type GitCommandResponse = CommandResponse

export type FileReadResponse = {
    success: boolean
    content?: string
    error?: string
}

export type GeneratedImageResponse = {
    success: boolean
    content?: string
    mimeType?: string
    fileName?: string
    error?: string
}

export type UploadFileResponse = {
    success: boolean
    path?: string
    error?: string
}

export type DeleteUploadResponse = {
    success: boolean
    error?: string
}

export type DirectoryEntry = {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

export type ListDirectoryResponse = {
    success: boolean
    entries?: DirectoryEntry[]
    error?: string
}

export type RpcListDirectoryResponse = ListDirectoryResponse

export type MachineDirectoryEntry = DirectoryEntry & {
    isGitRepo?: boolean
}

export type MachineListDirectoryResponse = {
    success: boolean
    entries?: MachineDirectoryEntry[]
    error?: string
}

export type PathExistsResponse = {
    exists: Record<string, boolean>
}

export type MachinePathsExistsResponse = PathExistsResponse

export type CodexModelSummary = {
    id: string
    displayName: string
    isDefault: boolean
    defaultReasoningEffort?: string | null
    supportedReasoningEfforts?: string[]
}

export type CodexModelsResponse = {
    success: boolean
    models?: CodexModelSummary[]
    error?: string
}

export type ListCodexModelsResponse = CodexModelsResponse

export type OpencodeModelSummary = {
    modelId: string
    name?: string
}

export type OpencodeModelsResponse = {
    success: boolean
    availableModels?: OpencodeModelSummary[]
    /** CLI `agent --list-models` skus grouped under ACP wire bases for variant pickers. */
    cliModelSkus?: OpencodeModelSummary[]
    currentModelId?: string | null
    error?: string
}

export type ListOpencodeModelsResponse = OpencodeModelsResponse

export type OpencodeReasoningEffortOption = {
    value: string
    name?: string
}

export type OpencodeReasoningEffortResponse = {
    success: boolean
    options?: OpencodeReasoningEffortOption[]
    currentValue?: string | null
    error?: string
}

export type CursorModelSummary = OpencodeModelSummary

export type CursorModelsResponse = OpencodeModelsResponse

export type ListCursorModelsResponse = CursorModelsResponse

// ── cc-switch 供应商集成 ──────────────────────────────────────────────
// cc-switch (~/.cc-switch/cc-switch.db) 管理 Claude Code 的供应商(gaccode/glm/deepseek 等),
// 切换供应商 = 改 ANTHROPIC_BASE_URL/AUTH_TOKEN(写入 ~/.claude/settings.json),是进程级动作。
// 注意:这些类型经 RPC 在机器间传输,绝不包含 token / settings_config 等敏感字段。

export type CcSwitchProviderSummary = {
    id: string
    name: string
    category?: string | null
    websiteUrl?: string | null
    isCurrent: boolean
    /** 该供应商是否配置了可用的用量查询脚本。 */
    hasUsageScript: boolean
}

export type ListCcSwitchProvidersResponse = {
    success: boolean
    providers?: CcSwitchProviderSummary[]
    /** cc-switch 是否可用(找到 db)。false 时 web 端回退到内置模型选项。 */
    available?: boolean
    error?: string
}

export type SwitchCcSwitchProviderRequest = {
    providerId: string
}

export type SwitchCcSwitchProviderResponse = {
    success: boolean
    /** 切换后当前供应商名,供 UI 即时反馈。 */
    currentProviderName?: string
    error?: string
}

/** 用量查询结果,对应 cc-switch usage_script extractor 的输出(已剥离敏感信息)。 */
export type CcSwitchUsageResult = {
    planName?: string | null
    total?: number | null
    remaining?: number | null
    unit?: string | null
    isValid: boolean
    invalidMessage?: string | null
}

export type QueryCcSwitchUsageResponse = {
    success: boolean
    providerName?: string
    usage?: CcSwitchUsageResult
    error?: string
}

export type SlashCommand = {
    name: string
    description?: string
    source: 'builtin' | 'user' | 'plugin' | 'project'
    content?: string
    pluginName?: string
}

export type SlashCommandsResponse = {
    success: boolean
    commands?: SlashCommand[]
    error?: string
}

// ----- 历史会话导入(功能1) -----
// 这些类型经 RPC 在机器间传输:CLI 在本地扫描/解析 claude code / codex 原生会话,
// hub(可能在 ECS,读不到本地盘)只负责把 CLI 回传的结果写入 DB。

/** 可导入的本地会话摘要(扫描结果,不含完整消息)。 */
export type ImportableSessionSummary = {
    /** agent 原生会话 id(claude/codex 的 sessionId)。 */
    id: string
    flavor: 'claude' | 'codex'
    title: string
    /** 最近一条用户消息预览(已截断)。 */
    lastUserMessage?: string | null
    /** 会话工作目录。 */
    cwd?: string | null
    /** 会话文件绝对路径(在 CLI 本机上)。 */
    file: string
    /** 文件最后修改时间(epoch ms)。 */
    modifiedAt: number
    /** 该会话可导入的可见消息条数(预估)。 */
    messageCount: number
    cliVersion?: string | null
}

export type ListImportableSessionsResponse = {
    success: boolean
    sessions?: ImportableSessionSummary[]
    error?: string
}

/** 已转换为 hapi 消息信封的单条消息(与 live CLI 发往 hub 的 content 格式一致)。 */
export type ImportedMessageContent = {
    role: 'user' | 'agent'
    content: unknown
    meta?: unknown
}

export type ReadImportableSessionRequest = {
    flavor: 'claude' | 'codex'
    /** 会话文件绝对路径(来自 summary.file);优先用它定位,避免重复全盘扫描。 */
    file: string
    /** agent 原生会话 id,用于构造导入会话的 metadata 与去重。 */
    id: string
}

export type ReadImportableSessionResponse = {
    success: boolean
    /** 转换后的 hapi 消息序列(按时间顺序)。 */
    messages?: ImportedMessageContent[]
    /** 构造 hapi 会话 metadata 的辅助字段。 */
    meta?: {
        title?: string | null
        cwd?: string | null
        cliVersion?: string | null
        modifiedAt?: number
    }
    error?: string
}

/** 单条会话的导入结果。 */
export type ImportSessionResultItem = {
    sourceId: string
    flavor: 'claude' | 'codex'
    success: boolean
    sessionId?: string
    /** created=新建会话;skipped-existing=此前已导入过,跳过。 */
    action?: 'created' | 'skipped-existing'
    messageCount?: number
    error?: string
}

/** 批量导入的汇总结果。 */
export type ImportSessionsResult = {
    success: boolean
    importedCount: number
    skippedCount: number
    failedCount: number
    results: ImportSessionResultItem[]
    error?: string
}
