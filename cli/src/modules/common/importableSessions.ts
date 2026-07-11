import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { ImportableSessionAgent, ImportableSessionSummary, ListImportableSessionsRequest, ListImportableSessionsResponse } from '@hapi/protocol/apiTypes'

type JsonRecord = Record<string, unknown>
const SCAN_WINDOW_SIZE = 50
const listedSessions = new Map<string, ImportableSessionSummary>()
const listedSessionPaths = new Map<string, string>()

function sessionKey(agent: ImportableSessionAgent, externalSessionId: string): string {
    return `${agent}:${externalSessionId}`
}

function record(value: unknown): JsonRecord | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function text(value: unknown): string {
    if (typeof value === 'string') return value
    if (!Array.isArray(value)) return ''
    return value.flatMap((item) => {
        const block = record(item)
        return block && typeof block.text === 'string' ? [block.text] : []
    }).join('\n')
}

function preview(value: string): string {
    const trimmed = value.trim()
    return trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed
}

async function collectJsonlFiles(root: string): Promise<string[]> {
    let entries
    try {
        entries = await readdir(root, { withFileTypes: true })
    } catch {
        return []
    }
    const files: string[] = []
    for (const entry of entries) {
        const path = join(root, entry.name)
        if (entry.isDirectory()) files.push(...await collectJsonlFiles(path))
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path)
    }
    return files
}

async function forEachJsonLine(path: string, visit: (value: JsonRecord) => void): Promise<void> {
    const input = createReadStream(path, { encoding: 'utf8' })
    const lines = createInterface({ input, crlfDelay: Infinity })
    try {
        for await (const line of lines) {
            if (!line.trim()) continue
            const parsed = JSON.parse(line) as unknown
            const value = record(parsed)
            if (!value) throw new Error(`Transcript line is not an object: ${path}`)
            visit(value)
        }
    } finally {
        lines.close()
        input.destroy()
    }
}

function realClaudeUserText(value: JsonRecord): string | null {
    if (value.type !== 'user' || value.isMeta === true || value.isSidechain === true || value.isCompactSummary === true) return null
    const message = record(value.message)
    const valueText = text(message?.content).trim()
    if (!valueText || /^<(task-notification|command-name|local-command-caveat|system-reminder|command-message|command-args)>/.test(valueText)) return null
    return valueText
}

async function scanClaude(path: string): Promise<ImportableSessionSummary | null> {
    const externalSessionId = basename(path, '.jsonl')
    let cwd: string | null = null
    let cliVersion: string | null = null
    let title: string | null = null
    let firstPrompt: string | null = null
    let lastPrompt: string | null = null
    let visibleMessages = 0
    await forEachJsonLine(path, (value) => {
        if (!cwd && typeof value.cwd === 'string') cwd = value.cwd
        if (!cliVersion && typeof value.version === 'string') cliVersion = value.version
        if (value.type === 'ai-title' && typeof value.title === 'string') title = preview(value.title)
        if (value.type === 'assistant') visibleMessages += 1
        const userText = realClaudeUserText(value)
        if (userText) {
            visibleMessages += 1
            firstPrompt ??= preview(userText)
            lastPrompt = preview(userText)
        }
    })
    if (visibleMessages === 0) return null
    const metadata = await stat(path)
    return {
        agent: 'claude', externalSessionId, cwd, timestamp: metadata.mtimeMs,
        previewTitle: title ?? firstPrompt ?? externalSessionId,
        previewPrompt: lastPrompt,
        messageCount: visibleMessages,
        cliVersion
    }
}

function codexUserText(value: JsonRecord): string | null {
    if (value.type !== 'response_item') return null
    const payload = record(value.payload)
    if (payload?.type !== 'message' || payload.role !== 'user') return null
    const valueText = text(payload.content).trim()
    if (!valueText || /^<(user_instructions|environment_context|user_action)>/.test(valueText)) return null
    return valueText
}

async function scanCodex(path: string): Promise<ImportableSessionSummary | null> {
    let externalSessionId: string | null = null
    let cwd: string | null = null
    let cliVersion: string | null = null
    let timestamp: number | null = null
    let title: string | null = null
    let firstPrompt: string | null = null
    let lastPrompt: string | null = null
    let visibleMessages = 0
    let child = false
    await forEachJsonLine(path, (value) => {
        const payload = record(value.payload)
        if (value.type === 'session_meta' && payload) {
            if (typeof payload.id === 'string') externalSessionId = payload.id
            if (typeof payload.cwd === 'string') cwd = payload.cwd
            if (typeof payload.cli_version === 'string') cliVersion = payload.cli_version
            if (typeof payload.timestamp === 'string') timestamp = Date.parse(payload.timestamp)
            const source = record(payload.source)
            child ||= Boolean(source && 'subagent' in source)
        }
        if (value.type === 'session_title_change' && typeof value.title === 'string') title = preview(value.title)
        if (value.type === 'response_item' && payload?.type === 'message' && payload.role === 'assistant') visibleMessages += 1
        const userText = codexUserText(value)
        if (userText) {
            visibleMessages += 1
            firstPrompt ??= preview(userText)
            lastPrompt = preview(userText)
        }
    })
    if (!externalSessionId || child || visibleMessages === 0) return null
    const metadata = await stat(path)
    return {
        agent: 'codex', externalSessionId, cwd, timestamp: timestamp !== null && Number.isFinite(timestamp) ? timestamp : metadata.mtimeMs,
        previewTitle: title ?? firstPrompt ?? externalSessionId,
        previewPrompt: lastPrompt,
        messageCount: visibleMessages,
        cliVersion
    }
}

export async function listImportableSessions(request: ListImportableSessionsRequest): Promise<ListImportableSessionsResponse> {
    const { agent } = request
    const root = agent === 'claude'
        ? join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
        : join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
    const files = await collectJsonlFiles(root)
    const filesByRecency: Array<{ path: string; modifiedAt: number }> = []
    for (const path of files) {
        filesByRecency.push({ path, modifiedAt: (await stat(path)).mtimeMs })
    }
    filesByRecency.sort((left, right) => right.modifiedAt - left.modifiedAt)
    const offset = request.cursor === undefined ? 0 : Number.parseInt(request.cursor, 10)
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid importable session cursor')
    const window = filesByRecency.slice(offset, offset + SCAN_WINDOW_SIZE)
    const sessions: ImportableSessionSummary[] = []
    for (const { path } of window) {
        const summary = agent === 'claude' ? await scanClaude(path) : await scanCodex(path)
        if (summary) {
            sessions.push(summary)
            listedSessions.set(sessionKey(agent, summary.externalSessionId), summary)
            listedSessionPaths.set(sessionKey(agent, summary.externalSessionId), path)
        }
    }
    sessions.sort((left, right) => right.timestamp - left.timestamp)
    const nextOffset = offset + window.length
    return { sessions, nextCursor: nextOffset < filesByRecency.length ? String(nextOffset) : null }
}

export function resolveImportableSession(agent: ImportableSessionAgent, externalSessionId: string): ImportableSessionSummary | null {
    return listedSessions.get(sessionKey(agent, externalSessionId)) ?? null
}

export function resolveImportableSessionPath(agent: ImportableSessionAgent, externalSessionId: string): string | null {
    return listedSessionPaths.get(sessionKey(agent, externalSessionId)) ?? null
}
