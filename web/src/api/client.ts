import type {
    AttachmentMetadata,
    AuthResponse,
    AccountSummary,
    ApiTokenSummary,
    ResourceGrantSummary,
    CodexLocalSessionsResponse,
    CodexDuplicateSessionsResponse,
    CodexMergeDuplicateSessionsResponse,
    CodexDesktopScriptResponse,
    CodexDesktopSyncRequest,
    CodexDesktopStatusResponse,
    CodexCollaborationMode,
    FileSearchResponse,
    MachinesResponse,
    MessagesResponse,
    PermissionMode,
    PushSubscriptionPayload,
    PushUnsubscribePayload,
    PushVapidPublicKeyResponse,
    SlashCommandsResponse,
    SkillsResponse,
    SpawnResponse,
    VisibilityPayload,
    HapiSessionExport,
    SessionResponse,
    SessionsResponse
} from '@/types/api'
import type {
    CodexModelsResponse,
    CursorMigrateOutcome,
    CursorMigrateToAcpRequest,
    CursorModelsResponse,
    DeleteUploadResponse,
    FileReadResponse,
    FileWriteResponse,
    GitCommandResponse,
    GrokModelsResponse,
    GrokReasoningEffortResponse,
    ListCcSwitchProvidersResponse,
    ListDirectoryResponse,
    MachineListDirectoryResponse,
    MachinePathsExistsResponse,
    OpencodeModelsResponse,
    OpencodeReasoningEffortResponse,
    ReopenSessionResponse,
    UploadFileResponse
} from '@hapi/protocol/apiTypes'
import type { AgentFlavor } from '@hapi/protocol'
import type { CancelMessageResponse } from '@hapi/protocol/schemas'

type ApiClientOptions = {
    baseUrl?: string
    getToken?: () => string | null
    onUnauthorized?: () => Promise<string | null>
}

type ErrorPayload = {
    error?: unknown
    code?: unknown
}

function parseErrorCode(bodyText: string): string | undefined {
    try {
        const parsed = JSON.parse(bodyText) as ErrorPayload
        if (typeof parsed.code === 'string') return parsed.code
        if (typeof parsed.error === 'string') return parsed.error
        return undefined
    } catch {
        return undefined
    }
}

export class ApiError extends Error {
    status: number
    code?: string
    body?: string

    constructor(message: string, status: number, code?: string, body?: string) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.code = code
        this.body = body
    }
}

export class ApiClient {
    private token: string
    private readonly baseUrl: string | null
    private readonly getToken: (() => string | null) | null
    private readonly onUnauthorized: (() => Promise<string | null>) | null

    constructor(token: string, options?: ApiClientOptions) {
        this.token = token
        this.baseUrl = options?.baseUrl ?? null
        this.getToken = options?.getToken ?? null
        this.onUnauthorized = options?.onUnauthorized ?? null
    }

    private buildUrl(path: string): string {
        if (!this.baseUrl) {
            return path
        }
        try {
            return new URL(path, this.baseUrl).toString()
        } catch {
            return path
        }
    }

    private async request<T>(
        path: string,
        init?: RequestInit,
        attempt: number = 0,
        overrideToken?: string | null
    ): Promise<T> {
        const headers = new Headers(init?.headers)
        const liveToken = this.getToken ? this.getToken() : null
        const authToken = overrideToken !== undefined
            ? (overrideToken ?? (liveToken ?? this.token))
            : (liveToken ?? this.token)
        if (authToken) {
            headers.set('authorization', `Bearer ${authToken}`)
        }
        if (init?.body !== undefined && !headers.has('content-type')) {
            headers.set('content-type', 'application/json')
        }

        const res = await fetch(this.buildUrl(path), {
            ...init,
            headers
        })

        if (res.status === 401) {
            if (attempt === 0 && this.onUnauthorized) {
                const refreshed = await this.onUnauthorized()
                if (refreshed) {
                    this.token = refreshed
                    return await this.request<T>(path, init, attempt + 1, refreshed)
                }
            }
            throw new Error('Session expired. Please sign in again.')
        }

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            throw new ApiError(
                `HTTP ${res.status} ${res.statusText}: ${body}`,
                res.status,
                code,
                body || undefined
            )
        }

        return await res.json() as T
    }

    async authenticate(auth: { initData: string } | { accessToken: string } | { username: string; password: string }): Promise<AuthResponse> {
        const res = await fetch(this.buildUrl('/api/auth'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(auth)
        })

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`Auth failed: HTTP ${res.status} ${res.statusText}${detail}`, res.status, code, body || undefined)
        }

        return await res.json() as AuthResponse
    }

    async bind(auth: { initData: string; accessToken: string }): Promise<AuthResponse> {
        const res = await fetch(this.buildUrl('/api/bind'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(auth)
        })

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`Bind failed: HTTP ${res.status} ${res.statusText}${detail}`, res.status, code, body || undefined)
        }

        return await res.json() as AuthResponse
    }

    async refreshAuth(): Promise<AuthResponse> {
        return await this.request<AuthResponse>('/api/auth/refresh', { method: 'POST' })
    }

    async getMe(): Promise<{ user: AccountSummary | { id: number; role: 'admin' | 'user'; username?: string; defaultNamespace?: string } }> {
        return await this.request('/api/me')
    }

    async listAccounts(): Promise<{ accounts: AccountSummary[] }> {
        return await this.request('/api/admin/accounts')
    }

    async createAccount(payload: { username: string; password?: string; role?: 'admin' | 'user'; defaultNamespace?: string }): Promise<{ account: AccountSummary }> {
        return await this.request('/api/admin/accounts', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async updateAccount(id: number, payload: { role?: 'admin' | 'user'; password?: string; disabled?: boolean; defaultNamespace?: string }): Promise<{ account: AccountSummary }> {
        return await this.request(`/api/admin/accounts/${encodeURIComponent(String(id))}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
        })
    }

    async deleteAccount(id: number): Promise<{ ok: boolean }> {
        return await this.request(`/api/admin/accounts/${encodeURIComponent(String(id))}`, { method: 'DELETE' })
    }

    async listApiTokens(): Promise<{ tokens: ApiTokenSummary[] }> {
        return await this.request('/api/tokens')
    }

    async createApiToken(payload: { name?: string; namespace?: string }): Promise<{ token: ApiTokenSummary }> {
        return await this.request('/api/tokens', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async revokeApiToken(id: number): Promise<{ ok: boolean }> {
        return await this.request(`/api/tokens/${encodeURIComponent(String(id))}`, { method: 'DELETE' })
    }

    async listResourceGrants(resourceType: 'machine' | 'session', resourceId: string): Promise<{ grants: ResourceGrantSummary[] }> {
        return await this.request(`/api/grants?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}`)
    }

    async createResourceGrant(payload: { resourceType: 'machine' | 'session'; resourceId: string; granteeUsername: string; role: 'viewer' | 'operator' }): Promise<{ grant: ResourceGrantSummary }> {
        return await this.request('/api/grants', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async deleteResourceGrant(payload: { resourceType: 'machine' | 'session'; resourceId: string; granteeAccountId: number }): Promise<{ ok: boolean }> {
        const query = new URLSearchParams({
            resourceType: payload.resourceType,
            resourceId: payload.resourceId,
            granteeAccountId: String(payload.granteeAccountId)
        })
        return await this.request(`/api/grants?${query.toString()}`, { method: 'DELETE' })
    }

    async getSessions(): Promise<SessionsResponse> {
        return await this.request<SessionsResponse>('/api/sessions')
    }

    async getPushVapidPublicKey(): Promise<PushVapidPublicKeyResponse> {
        return await this.request<PushVapidPublicKeyResponse>('/api/push/vapid-public-key')
    }

    async subscribePushNotifications(payload: PushSubscriptionPayload): Promise<void> {
        await this.request('/api/push/subscribe', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async syncCodexSession(payload?: CodexDesktopSyncRequest): Promise<CodexDesktopScriptResponse> {
        // 中文注释：当前按钮语义已改为“从 Codex 导入到 Hapi”；这里提交的是本地 transcript 对应的 Codex thread ID 列表。
        return await this.request<CodexDesktopScriptResponse>('/api/codex/sync-session', {
            method: 'POST',
            ...(payload ? { body: JSON.stringify(payload) } : {})
        })
    }

    async getCodexSessions(): Promise<CodexLocalSessionsResponse> {
        return await this.request<CodexLocalSessionsResponse>('/api/codex/sessions')
    }

    async getCodexDesktopStatus(): Promise<CodexDesktopStatusResponse> {
        return await this.request<CodexDesktopStatusResponse>('/api/codex/status')
    }

    async getCodexDuplicateSessions(payload: CodexDesktopSyncRequest): Promise<CodexDuplicateSessionsResponse> {
        // 中文注释：重复会话检测只传本次用户勾选导入的 codexSessionId，避免把未选中的历史会话也纳入提示。
        return await this.request<CodexDuplicateSessionsResponse>('/api/codex/duplicate-sessions', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async mergeCodexDuplicateSessions(payload: CodexDesktopSyncRequest): Promise<CodexMergeDuplicateSessionsResponse> {
        // 中文注释：真正执行合并时沿用同一批选中 codexSessionId，保证检测范围与执行范围一致。
        return await this.request<CodexMergeDuplicateSessionsResponse>('/api/codex/merge-duplicate-sessions', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async restartCodexDesktop(): Promise<CodexDesktopScriptResponse> {
        return await this.request<CodexDesktopScriptResponse>('/api/codex/restart-desktop', {
            method: 'POST'
        })
    }

    async unsubscribePushNotifications(payload: PushUnsubscribePayload): Promise<void> {
        await this.request('/api/push/subscribe', {
            method: 'DELETE',
            body: JSON.stringify(payload)
        })
    }

    async setVisibility(payload: VisibilityPayload): Promise<void> {
        await this.request('/api/visibility', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async getSession(sessionId: string): Promise<SessionResponse> {
        return await this.request<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`)
    }

    async getSessionExport(sessionId: string, options?: { signal?: AbortSignal }): Promise<HapiSessionExport> {
        return await this.request<HapiSessionExport>(
            `/api/sessions/${encodeURIComponent(sessionId)}/export`,
            { signal: options?.signal }
        )
    }

    async getMessages(
        sessionId: string,
        options: {
            beforeSeq?: number | null
            beforeAt?: number | null
            limit?: number
        }
    ): Promise<MessagesResponse> {
        const params = new URLSearchParams()
        if (options.beforeAt !== undefined && options.beforeAt !== null) {
            params.set('beforeAt', `${options.beforeAt}`)
        }
        if (options.beforeSeq !== undefined && options.beforeSeq !== null) {
            params.set('beforeSeq', `${options.beforeSeq}`)
        }
        if (options.limit !== undefined && options.limit !== null) {
            params.set('limit', `${options.limit}`)
        }

        const qs = params.toString()
        const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`
        return await this.request<MessagesResponse>(url)
    }

    async getGitStatus(sessionId: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-status`)
    }

    async getGitDiffNumstat(sessionId: string, staged: boolean): Promise<GitCommandResponse> {
        const params = new URLSearchParams()
        params.set('staged', staged ? 'true' : 'false')
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-diff-numstat?${params.toString()}`)
    }

    async getGitDiffFile(sessionId: string, path: string, staged?: boolean): Promise<GitCommandResponse> {
        const params = new URLSearchParams()
        params.set('path', path)
        if (staged !== undefined) {
            params.set('staged', staged ? 'true' : 'false')
        }
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-diff-file?${params.toString()}`)
    }

    async searchSessionFiles(sessionId: string, query: string, limit?: number): Promise<FileSearchResponse> {
        const params = new URLSearchParams()
        if (query) {
            params.set('query', query)
        }
        if (limit !== undefined) {
            params.set('limit', `${limit}`)
        }
        const qs = params.toString()
        return await this.request<FileSearchResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/files${qs ? `?${qs}` : ''}`)
    }

    async getGeneratedImageBlob(sessionId: string, imageId: string, attempt: number = 0, overrideToken?: string | null): Promise<Blob> {
        const headers = new Headers()
        const liveToken = this.getToken ? this.getToken() : null
        const authToken = overrideToken !== undefined
            ? (overrideToken ?? (liveToken ?? this.token))
            : (liveToken ?? this.token)
        if (authToken) {
            headers.set('authorization', `Bearer ${authToken}`)
        }
        const url = this.buildUrl(`/api/sessions/${encodeURIComponent(sessionId)}/generated-images/${encodeURIComponent(imageId)}`)
        let res = await fetch(url, { headers })
        if (res.status === 304) {
            res = await fetch(url, { headers, cache: 'force-cache' })
        }
        if (res.status === 401 && attempt === 0 && this.onUnauthorized) {
            const refreshed = await this.onUnauthorized()
            if (refreshed) {
                this.token = refreshed
                return await this.getGeneratedImageBlob(sessionId, imageId, attempt + 1, refreshed)
            }
        }
        if (!res.ok) {
            throw new ApiError(`HTTP ${res.status}`, res.status, undefined, await res.text().catch(() => undefined))
        }
        return await res.blob()
    }

    async getGeneratedFileBlob(sessionId: string, fileId: string, attempt: number = 0, overrideToken?: string | null): Promise<Blob> {
        const headers = new Headers()
        const liveToken = this.getToken ? this.getToken() : null
        const authToken = overrideToken !== undefined
            ? (overrideToken ?? (liveToken ?? this.token))
            : (liveToken ?? this.token)
        if (authToken) {
            headers.set('authorization', `Bearer ${authToken}`)
        }
        const res = await fetch(this.buildUrl(`/api/sessions/${encodeURIComponent(sessionId)}/generated-files/${encodeURIComponent(fileId)}`), {
            headers
        })
        if (res.status === 401 && attempt === 0 && this.onUnauthorized) {
            const refreshed = await this.onUnauthorized()
            if (refreshed) {
                this.token = refreshed
                return await this.getGeneratedFileBlob(sessionId, fileId, attempt + 1, refreshed)
            }
        }
        if (!res.ok) {
            throw new ApiError(`HTTP ${res.status}`, res.status, undefined, await res.text().catch(() => undefined))
        }
        return await res.blob()
    }

    async readSessionFile(sessionId: string, path: string): Promise<FileReadResponse> {
        const params = new URLSearchParams()
        params.set('path', path)
        return await this.request<FileReadResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/file?${params.toString()}`)
    }

    async writeSessionFile(sessionId: string, path: string, content: string, expectedHash: string): Promise<FileWriteResponse> {
        return await this.request<FileWriteResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/file`, {
            method: 'PUT',
            body: JSON.stringify({ path, content, expectedHash })
        })
    }

    async listSessionDirectory(sessionId: string, path?: string): Promise<ListDirectoryResponse> {
        const params = new URLSearchParams()
        if (path) {
            params.set('path', path)
        }

        const qs = params.toString()
        return await this.request<ListDirectoryResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/directory${qs ? `?${qs}` : ''}`
        )
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<UploadFileResponse> {
        return await this.request<UploadFileResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/upload`, {
            method: 'POST',
            body: JSON.stringify({ filename, content, mimeType })
        })
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<DeleteUploadResponse> {
        return await this.request<DeleteUploadResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/upload/delete`, {
            method: 'POST',
            body: JSON.stringify({ path })
        })
    }

    async resumeSession(sessionId: string, opts?: { permissionMode?: string }): Promise<string> {
        const response = await this.request<{ sessionId: string }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/resume`,
            {
                method: 'POST',
                ...(opts?.permissionMode !== undefined && {
                    body: JSON.stringify({ permissionMode: opts.permissionMode })
                })
            }
        )
        return response.sessionId
    }

    async restartSession(sessionId: string, ccSwitchProviderId?: string): Promise<string> {
        const response = await this.request<{ sessionId: string }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/restart`,
            { method: 'POST', body: JSON.stringify({ ccSwitchProviderId }) }
        )
        return response.sessionId
    }

    async sendMessage(sessionId: string, text: string, localId?: string | null, attachments?: AttachmentMetadata[], scheduledAt?: number | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                text,
                localId: localId ?? undefined,
                attachments: attachments ?? undefined,
                scheduledAt: scheduledAt ?? undefined
            })
        })
    }

    async cancelMessage(sessionId: string, messageId: string): Promise<CancelMessageResponse> {
        const response = await this.request(
            `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`,
            { method: 'DELETE' }
        )
        return response as CancelMessageResponse
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async archiveSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async reopenSession(sessionId: string): Promise<ReopenSessionResponse> {
        return await this.request<ReopenSessionResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/reopen`,
            { method: 'POST', body: JSON.stringify({}) }
        )
    }

    /**
     * Session fork (fork-features/session-fork). Returns the new hapi session
     * id for the forked copy.
     */
    /**
     * Fork a session. Absent `forkPoint` = HEAD fork (session-level menu
     * entry). With `forkPoint.messageId` = per-message fork (UserMessage
     * trailing-row rewind button, capability-gated to at-message flavors).
     * Hub computes `tailOffset` from the source session's messages table;
     * clients don't send it.
     */
    async forkSession(
        sessionId: string,
        opts?: { forkPoint?: { messageId: string } }
    ): Promise<{ newSessionId: string }> {
        const body: Record<string, unknown> = {}
        if (opts?.forkPoint) body.forkPoint = opts.forkPoint
        return await this.request<{ newSessionId: string }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/fork`,
            { method: 'POST', body: JSON.stringify(body) }
        )
    }

    /**
     * Returns per-flavor fork capability shape (see
     * `useFlavorCapabilities`). Web uses it to capability-gate the
     * session-level Fork menu and the per-message rewind button.
     */
    async getFlavorCapabilities(): Promise<{
        capabilities: Record<string, { fork: 'none' | 'head-only' | 'at-message'; files: 'none' }>
    }> {
        return await this.request('/api/flavors/capabilities')
    }

    /**
     * Migrate a legacy stream-json Cursor session to ACP. See tiann/hapi#824.
     *
     * Refusals (e.g. running session, missing on-disk store, target collision)
     * are returned as structured `{ok: false, reason, message}` outcomes
     * rather than thrown - the UI surfaces the reason to the operator and the
     * underlying state on disk is unchanged.
     *
     * 401s trigger the same onUnauthorized refresh path as the shared
     * `request()` helper so an expired JWT silently re-auths instead of
     * hard-failing the migration dialog (Codex review #34 P2).
     */
    async migrateCursorSessionToAcp(sessionId: string, body: CursorMigrateToAcpRequest = {}): Promise<CursorMigrateOutcome> {
        const path = `/api/sessions/${encodeURIComponent(sessionId)}/migrate-to-acp`
        const tryOnce = async (overrideToken: string | null): Promise<Response> => {
            const headers = new Headers({ 'content-type': 'application/json' })
            const liveToken = this.getToken ? this.getToken() : null
            const authToken = overrideToken ?? liveToken ?? this.token
            if (authToken) {
                headers.set('authorization', `Bearer ${authToken}`)
            }
            return fetch(this.buildUrl(path), { method: 'POST', headers, body: JSON.stringify(body) })
        }

        let res = await tryOnce(null)
        if (res.status === 401 && this.onUnauthorized) {
            const refreshed = await this.onUnauthorized()
            if (refreshed) {
                this.token = refreshed
                res = await tryOnce(refreshed)
            }
        }
        if (res.status === 401) {
            throw new Error('Session expired. Please sign in again.')
        }
        const text = await res.text()
        let parsed: CursorMigrateOutcome | null = null
        try {
            parsed = text ? JSON.parse(text) as CursorMigrateOutcome : null
        } catch {
            parsed = null
        }
        if (parsed && typeof parsed === 'object' && 'ok' in parsed) {
            return parsed
        }
        throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`)
    }

    async switchSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/switch`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permission-mode`, {
            method: 'POST',
            body: JSON.stringify({ mode })
        })
    }

    async setCollaborationMode(sessionId: string, mode: CodexCollaborationMode): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/collaboration-mode`, {
            method: 'POST',
            body: JSON.stringify({ mode })
        })
    }

    async setModel(sessionId: string, model: { provider: string; modelId: string } | string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/model`, {
            method: 'POST',
            body: JSON.stringify({ model })
        })
    }

    async setResumeWithSessionModel(sessionId: string, resumeWithSessionModel: boolean): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/resume-model`, {
            method: 'POST',
            body: JSON.stringify({ resumeWithSessionModel })
        })
    }

    async setModelReasoningEffort(sessionId: string, modelReasoningEffort: string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/model-reasoning-effort`, {
            method: 'POST',
            body: JSON.stringify({ modelReasoningEffort })
        })
    }

    async setEffort(sessionId: string, effort: string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/effort`, {
            method: 'POST',
            body: JSON.stringify({ effort })
        })
    }

    async setServiceTier(sessionId: string, serviceTier: string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/service-tier`, {
            method: 'POST',
            body: JSON.stringify({ serviceTier })
        })
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        modeOrOptions?: 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan' | {
            mode?: 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan'
            allowTools?: string[]
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
            answers?: Record<string, string[]> | Record<string, { answers: string[] }>
        }
    ): Promise<void> {
        const body = typeof modeOrOptions === 'string' || modeOrOptions === undefined
            ? { mode: modeOrOptions }
            : modeOrOptions
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/approve`, {
            method: 'POST',
            body: JSON.stringify(body)
        })
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        options?: {
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
        }
    ): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/deny`, {
            method: 'POST',
            body: JSON.stringify(options ?? {})
        })
    }

    async getMachines(): Promise<MachinesResponse> {
        return await this.request<MachinesResponse>('/api/machines')
    }

    async listMachineDirectory(
        machineId: string,
        path: string
    ): Promise<MachineListDirectoryResponse> {
        return await this.request<MachineListDirectoryResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/list-directory`,
            {
                method: 'POST',
                body: JSON.stringify({ path })
            }
        )
    }

    async createMachineDirectory(
        machineId: string,
        parentPath: string,
        name: string
    ): Promise<import('@hapi/protocol/apiTypes').MachineCreateDirectoryResponse> {
        return await this.request(
            `/api/machines/${encodeURIComponent(machineId)}/create-directory`,
            {
                method: 'POST',
                body: JSON.stringify({ parentPath, name })
            }
        )
    }

    async checkMachinePathsExists(
        machineId: string,
        paths: string[]
    ): Promise<MachinePathsExistsResponse> {
        return await this.request<MachinePathsExistsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/paths/exists`,
            {
                method: 'POST',
                body: JSON.stringify({ paths })
            }
        )
    }

    async spawnSession(
        machineId: string,
        directory: string,
        agent?: AgentFlavor,
        model?: string,
        modelReasoningEffort?: string,
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        effort?: string,
        permissionMode?: PermissionMode
    ): Promise<SpawnResponse> {
        return await this.request<SpawnResponse>(`/api/machines/${encodeURIComponent(machineId)}/spawn`, {
            method: 'POST',
            body: JSON.stringify({
                directory,
                agent,
                model,
                modelReasoningEffort,
                yolo,
                sessionType,
                worktreeName,
                effort,
                permissionMode
            })
        })
    }

    async getMachineCodexModels(machineId: string): Promise<CodexModelsResponse> {
        return await this.request<CodexModelsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/codex-models`
        )
    }

    async getMachineCcSwitchProviders(machineId: string): Promise<ListCcSwitchProvidersResponse> {
        return await this.request<ListCcSwitchProvidersResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/cc-switch/providers`
        )
    }

    async getSessionOpencodeModels(sessionId: string): Promise<OpencodeModelsResponse> {
        return await this.request<OpencodeModelsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/opencode-models`
        )
    }

    async getSessionOpencodeReasoningEffortOptions(sessionId: string): Promise<OpencodeReasoningEffortResponse> {
        return await this.request<OpencodeReasoningEffortResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/opencode-reasoning-effort-options`
        )
    }

    async getSessionCursorModels(sessionId: string): Promise<CursorModelsResponse> {
        return await this.request<CursorModelsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/cursor-models`
        )
    }

    /** Generic Pi session endpoint — replaces per-method wrappers. */
    async callPiEndpoint<T = unknown>(sessionId: string, path: string, init?: RequestInit): Promise<T> {
        return await this.request<T>(
            `/api/sessions/${encodeURIComponent(sessionId)}/pi-${path}`,
            init
        )
    }

    async getMachineCursorModels(machineId: string): Promise<CursorModelsResponse> {
        return await this.request<CursorModelsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/cursor-models`
        )
    }

    async getMachineOpencodeModelsForCwd(machineId: string, cwd: string): Promise<OpencodeModelsResponse> {
        return await this.request<OpencodeModelsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/opencode-models?cwd=${encodeURIComponent(cwd)}`
        )
    }

    async getMachineGrokModelsForCwd(machineId: string, cwd: string): Promise<GrokModelsResponse> {
        return await this.request<GrokModelsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/grok-models?cwd=${encodeURIComponent(cwd)}`
        )
    }

    async getSessionGrokModels(sessionId: string): Promise<GrokModelsResponse> {
        return await this.request<GrokModelsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/grok-models`
        )
    }

    async getSessionGrokReasoningEffortOptions(sessionId: string): Promise<GrokReasoningEffortResponse> {
        return await this.request<GrokReasoningEffortResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/grok-reasoning-effort-options`
        )
    }

    async getSlashCommands(sessionId: string): Promise<SlashCommandsResponse> {
        return await this.request<SlashCommandsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/slash-commands`
        )
    }

    async getSkills(sessionId: string): Promise<SkillsResponse> {
        return await this.request<SkillsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/skills`
        )
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ name })
        })
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE'
        })
    }

    async fetchVoiceToken(options?: { customAgentId?: string; customApiKey?: string; voiceId?: string }): Promise<{
        allowed: boolean
        token?: string
        agentId?: string
        error?: string
    }> {
        return await this.request('/api/voice/token', {
            method: 'POST',
            body: JSON.stringify(options || {})
        })
    }

    async fetchVoices(): Promise<{ voices: Array<{ id: string; name: string; previewUrl: string; category: string }> }> {
        return await this.request('/api/voice/voices')
    }

    async sendVoiceTelemetry(event: {
        stage: string
        message: string
        sessionId?: string
        voiceId?: string
        language?: string
        details?: Record<string, unknown>
    }): Promise<void> {
        await this.request('/api/voice/telemetry', {
            method: 'POST',
            body: JSON.stringify(event)
        })
    }

    /** Return the current auth token (for WebSocket query-param auth). */
    getAuthToken(): string | null {
        return this.getToken ? this.getToken() : this.token
    }

    async fetchVoiceBackend(): Promise<{ backend: string; backends: string[] }> {
        return await this.request('/api/voice/backend')
    }

    async fetchQwenToken(): Promise<{
        allowed: boolean
        wsUrl?: string
        error?: string
    }> {
        return await this.request('/api/voice/qwen-token', {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async fetchGeminiToken(): Promise<{
        allowed: boolean
        apiKey?: string
        wsUrl?: string
        baseUrl?: string
        error?: string
    }> {
        return await this.request('/api/voice/gemini-token', {
            method: 'POST',
            body: JSON.stringify({})
        })
    }
}
