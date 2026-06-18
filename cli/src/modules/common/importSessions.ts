/**
 * 历史会话导入(功能1)的 CLI 侧实现。
 *
 * 设计要点:claude code / codex 的原生会话文件都在本机(~/.claude/projects、~/.codex/sessions)。
 * hub 可能部署在 ECS,读不到这些本地盘,所以扫描/解析/格式转换全部在 CLI 完成,
 * 只把转换好的 hapi 消息信封经 RPC 回传给 hub 写库。
 *
 * Claude 消息转换刻意复用与 live 本地会话相同的封装(见 apiSession.sendClaudeSessionMessage):
 * 用户消息 -> { role:'user', content:{type:'text',text}, meta }
 * 其余可见消息 -> { role:'agent', content:{type:'output', data:<原始jsonl行>}, meta }
 * 这样导入的消息与正常会话在 web 端走同一条 normalize 渲染路径,显示一致。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { logger } from '@/ui/logger'
import type {
    ImportableSessionSummary,
    ImportedMessageContent,
    ReadImportableSessionResponse
} from '@hapi/protocol/apiTypes'

const MAX_PREVIEW_LENGTH = 160
const SCAN_LIMIT = 500

// claude code 写入会话文件、但不属于会话内容的内部事件,扫描时跳过(与 sessionScanner 对齐)。
const CLAUDE_INTERNAL_TYPES = new Set([
    'file-history-snapshot',
    'change',
    'queue-operation',
    'summary',
    'mode',
    'permission-mode',
    'ai-title',
    'last-prompt'
])

function getClaudeProjectsRoot(): string {
    const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
    return join(configDir, 'projects')
}

function getCodexSessionsRoot(): string {
    const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
    return join(codexHome, 'sessions')
}

function truncate(value: string, max = MAX_PREVIEW_LENGTH): string {
    const trimmed = value.trim()
    return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

/** 从 claude/codex 的 content(可能是字符串或块数组)提取纯文本预览。 */
function extractText(content: unknown): string {
    if (typeof content === 'string') {
        return content
    }
    if (Array.isArray(content)) {
        const parts: string[] = []
        for (const block of content) {
            const record = asRecord(block)
            if (!record) continue
            if (record.type === 'text' && typeof record.text === 'string') {
                parts.push(record.text)
            }
        }
        return parts.join('\n')
    }
    const record = asRecord(content)
    if (record && typeof record.text === 'string') {
        return record.text
    }
    return ''
}

// ----- Claude Code 会话 -----

type JsonlLine = Record<string, unknown>

function readJsonlLines(filePath: string): JsonlLine[] {
    let raw: string
    try {
        raw = readFileSync(filePath, 'utf-8')
    } catch {
        return []
    }
    const out: JsonlLine[] = []
    for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
            const parsed = JSON.parse(trimmed)
            if (parsed && typeof parsed === 'object') {
                out.push(parsed as JsonlLine)
            }
        } catch {
            // 跳过损坏行
        }
    }
    return out
}

/** 一条 claude jsonl 行是否属于"可见会话内容"(过滤内部事件、meta、压缩摘要)。 */
function isClaudeVisibleLine(line: JsonlLine): boolean {
    const type = typeof line.type === 'string' ? line.type : ''
    if (!type || CLAUDE_INTERNAL_TYPES.has(type)) return false
    if (line.isMeta === true || line.isCompactSummary === true) return false
    if (line.isSidechain === true) return false
    if (type === 'system') {
        const subtype = typeof line.subtype === 'string' ? line.subtype : ''
        return ['api_error', 'turn_duration', 'microcompact_boundary', 'compact_boundary'].includes(subtype)
    }
    return type === 'user' || type === 'assistant'
}

/** 判断是否为真实外部用户输入(排除 tool_result、系统注入的 <...> 标签等)。 */
function isRealUserLine(line: JsonlLine): boolean {
    if (line.type !== 'user') return false
    const message = asRecord(line.message)
    if (!message) return false
    const content = message.content
    if (typeof content === 'string') {
        const text = content.trim()
        if (!text) return false
        if (/^<(task-notification|command-name|local-command-caveat|system-reminder|command-message|command-args)>/.test(text)) {
            return false
        }
        return true
    }
    if (Array.isArray(content)) {
        return content.some((b) => {
            const r = asRecord(b)
            return r?.type === 'text' && typeof r.text === 'string' && r.text.trim() !== ''
        })
    }
    return false
}

/** 把一条 claude jsonl 行转成 hapi 消息信封(与 sendClaudeSessionMessage 一致)。 */
function convertClaudeLine(line: JsonlLine): ImportedMessageContent | null {
    if (!isClaudeVisibleLine(line)) return null
    if (isRealUserLine(line)) {
        const message = asRecord(line.message)
        const text = extractText(message?.content)
        return {
            role: 'user',
            content: { type: 'text', text },
            meta: { sentFrom: 'cli', imported: true }
        }
    }
    return {
        role: 'agent',
        content: { type: 'output', data: line },
        meta: { sentFrom: 'cli', imported: true }
    }
}

function claudeSessionTitle(lines: JsonlLine[]): string {
    for (const line of lines) {
        if (line.type === 'ai-title' && typeof line.title === 'string' && line.title.trim()) {
            return truncate(line.title, 80)
        }
    }
    for (const line of lines) {
        if (isRealUserLine(line)) {
            const message = asRecord(line.message)
            const text = extractText(message?.content)
            if (text.trim()) return truncate(text, 80)
        }
    }
    return 'Claude 会话'
}

function lastRealUserMessage(lines: JsonlLine[]): string | null {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (isRealUserLine(lines[i])) {
            const message = asRecord(lines[i].message)
            const text = extractText(message?.content)
            if (text.trim()) return truncate(text)
        }
    }
    return null
}

function buildClaudeSummary(filePath: string): ImportableSessionSummary | null {
    let stat
    try {
        stat = statSync(filePath)
    } catch {
        return null
    }
    const lines = readJsonlLines(filePath)
    if (lines.length === 0) return null
    const visibleCount = lines.filter(isClaudeVisibleLine).length
    if (visibleCount === 0) return null
    const id = basename(filePath).replace(/\.jsonl$/, '')
    let cwd: string | null = null
    let cliVersion: string | null = null
    for (const line of lines) {
        if (!cwd && typeof line.cwd === 'string') cwd = line.cwd
        if (!cliVersion && typeof line.version === 'string') cliVersion = line.version
        if (cwd && cliVersion) break
    }
    return {
        id,
        flavor: 'claude',
        title: claudeSessionTitle(lines),
        lastUserMessage: lastRealUserMessage(lines),
        cwd,
        file: filePath,
        modifiedAt: stat.mtimeMs,
        messageCount: visibleCount,
        cliVersion
    }
}

function listClaudeSessionFiles(): string[] {
    const root = getClaudeProjectsRoot()
    const files: string[] = []
    let projectDirs: string[]
    try {
        projectDirs = readdirSync(root, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => join(root, e.name))
    } catch {
        return []
    }
    for (const dir of projectDirs) {
        try {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                    files.push(join(dir, entry.name))
                }
            }
        } catch {
            // 跳过不可读目录
        }
    }
    return files
}

// ----- Codex 会话 -----
// Codex 原生格式与 hapi 的转换沿用 hub/web/routes/codexDesktop.ts 的映射:
// 用户消息 -> { role:'user', content:{type:'text',text} }
// agent 消息/推理/工具调用 -> { role:'agent', content:{ type:'codex', data:{...} } }

const CODEX_AGENT_PAYLOAD_TYPE = 'codex'

function buildCodexUser(text: string): ImportedMessageContent {
    return {
        role: 'user',
        content: { type: 'text', text },
        meta: { sentFrom: 'cli', imported: true }
    }
}

function buildCodexAgent(data: unknown): ImportedMessageContent {
    return {
        role: 'agent',
        content: { type: CODEX_AGENT_PAYLOAD_TYPE, data },
        meta: { sentFrom: 'cli', imported: true }
    }
}

function isSyntheticCodexText(text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed) return true
    // Codex 注入的环境上下文/指令前缀,不作为可见消息
    return /^<(user_instructions|environment_context|user_action)>/.test(trimmed)
}

function randomId(): string {
    return `imp-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

function convertCodexRecord(record: JsonlLine): ImportedMessageContent | null {
    const type = typeof record.type === 'string' ? record.type : ''
    const payload = asRecord(record.payload)
    if (!type || !payload) return null

    if (type === 'event_msg') {
        const eventType = typeof payload.type === 'string' ? payload.type : ''
        if (eventType === 'user_message') {
            const text = extractText(payload.message ?? payload.text ?? payload.content)
            if (!text || isSyntheticCodexText(text)) return null
            return buildCodexUser(text)
        }
        if (eventType === 'agent_message') {
            const message = extractText(payload.message)
            return message ? buildCodexAgent({ type: 'message', message, id: randomId() }) : null
        }
        if (eventType === 'agent_reasoning') {
            const message = extractText(payload.text ?? payload.message)
            return message ? buildCodexAgent({ type: 'reasoning', message, id: randomId() }) : null
        }
        return null
    }

    if (type === 'response_item') {
        const itemType = typeof payload.type === 'string' ? payload.type : ''
        if (itemType === 'message') {
            const role = typeof payload.role === 'string' ? payload.role : ''
            const text = extractText(payload.content)
            if (!text || isSyntheticCodexText(text)) return null
            if (role === 'user') return buildCodexUser(text)
            if (role === 'assistant') return buildCodexAgent({ type: 'message', message: text, id: randomId() })
            return null
        }
        if (itemType === 'function_call') {
            const name = typeof payload.name === 'string' ? payload.name : ''
            const callId = typeof payload.call_id === 'string' ? payload.call_id
                : typeof payload.callId === 'string' ? payload.callId : ''
            if (!name || !callId) return null
            let input: unknown = payload.arguments
            if (typeof input === 'string') {
                try { input = JSON.parse(input) } catch { /* 保留原字符串 */ }
            }
            return buildCodexAgent({ type: 'tool-call', name, callId, input, id: randomId() })
        }
        if (itemType === 'function_call_output') {
            const callId = typeof payload.call_id === 'string' ? payload.call_id
                : typeof payload.callId === 'string' ? payload.callId : ''
            if (!callId) return null
            return buildCodexAgent({ type: 'tool-call-result', callId, output: payload.output, id: randomId() })
        }
    }
    return null
}

function isCodexVisibleRecord(record: JsonlLine): boolean {
    return convertCodexRecord(record) !== null
}

function codexSessionMeta(lines: JsonlLine[]): { id: string | null; cwd: string | null; cliVersion: string | null } {
    for (const line of lines) {
        if (line.type === 'session_meta') {
            const payload = asRecord(line.payload)
            const id = typeof payload?.id === 'string' ? payload.id : null
            const cwd = typeof payload?.cwd === 'string' ? payload.cwd : null
            const cliVersion = typeof payload?.cli_version === 'string' ? payload.cli_version : null
            return { id, cwd, cliVersion }
        }
    }
    return { id: null, cwd: null, cliVersion: null }
}

function codexIdFromFile(filePath: string): string {
    // rollout-2026-05-31T01-57-51-019e7a09-...-....jsonl -> 取末尾 UUID 段
    const base = basename(filePath).replace(/\.jsonl$/, '')
    const match = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
    return match ? match[1] : base
}

function buildCodexSummary(filePath: string): ImportableSessionSummary | null {
    let stat
    try {
        stat = statSync(filePath)
    } catch {
        return null
    }
    const lines = readJsonlLines(filePath)
    if (lines.length === 0) return null
    const visible = lines.filter(isCodexVisibleRecord)
    if (visible.length === 0) return null
    const meta = codexSessionMeta(lines)
    const id = meta.id ?? codexIdFromFile(filePath)

    let title = 'Codex 会话'
    let lastUser: string | null = null
    for (const record of lines) {
        const converted = convertCodexRecord(record)
        if (converted?.role === 'user') {
            const content = asRecord(converted.content)
            const text = typeof content?.text === 'string' ? content.text : ''
            if (text.trim()) {
                if (title === 'Codex 会话') title = truncate(text, 80)
                lastUser = truncate(text)
            }
        }
    }
    return {
        id,
        flavor: 'codex',
        title,
        lastUserMessage: lastUser,
        cwd: meta.cwd,
        file: filePath,
        modifiedAt: stat.mtimeMs,
        messageCount: visible.length,
        cliVersion: meta.cliVersion
    }
}

function listCodexSessionFiles(): string[] {
    const root = getCodexSessionsRoot()
    const files: string[] = []
    const walk = (dir: string, depth: number): void => {
        if (depth > 6) return
        let entries
        try {
            entries = readdirSync(dir, { withFileTypes: true })
        } catch {
            return
        }
        for (const entry of entries) {
            const full = join(dir, entry.name)
            if (entry.isDirectory()) {
                walk(full, depth + 1)
            } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                files.push(full)
            }
        }
    }
    walk(root, 0)
    return files
}

// ----- 对外入口(供 RPC handler 调用) -----

/** 扫描本机所有可导入的 claude code / codex 会话,按修改时间倒序返回摘要。 */
export function listImportableSessions(limit = SCAN_LIMIT): ImportableSessionSummary[] {
    const summaries: ImportableSessionSummary[] = []
    for (const file of listClaudeSessionFiles()) {
        try {
            const summary = buildClaudeSummary(file)
            if (summary) summaries.push(summary)
        } catch (error) {
            logger.debug('[import] 解析 claude 会话失败:', file, error)
        }
    }
    for (const file of listCodexSessionFiles()) {
        try {
            const summary = buildCodexSummary(file)
            if (summary) summaries.push(summary)
        } catch (error) {
            logger.debug('[import] 解析 codex 会话失败:', file, error)
        }
    }
    summaries.sort((a, b) => b.modifiedAt - a.modifiedAt)
    return summaries.slice(0, limit)
}

/** 读取并转换单个会话文件为 hapi 消息序列。 */
export function readImportableSession(args: {
    flavor: 'claude' | 'codex'
    file: string
}): ReadImportableSessionResponse {
    const lines = readJsonlLines(args.file)
    if (lines.length === 0) {
        return { success: false, error: '会话文件为空或不可读' }
    }

    let stat
    try {
        stat = statSync(args.file)
    } catch {
        stat = null
    }

    const messages: ImportedMessageContent[] = []
    if (args.flavor === 'claude') {
        for (const line of lines) {
            const converted = convertClaudeLine(line)
            if (converted) messages.push(converted)
        }
    } else {
        for (const record of lines) {
            const converted = convertCodexRecord(record)
            if (converted) messages.push(converted)
        }
    }

    if (messages.length === 0) {
        return { success: false, error: '没有可导入的会话内容' }
    }

    const summary = args.flavor === 'claude'
        ? buildClaudeSummary(args.file)
        : buildCodexSummary(args.file)

    return {
        success: true,
        messages,
        meta: {
            title: summary?.title ?? null,
            cwd: summary?.cwd ?? null,
            cliVersion: summary?.cliVersion ?? null,
            modifiedAt: stat?.mtimeMs ?? summary?.modifiedAt
        }
    }
}
