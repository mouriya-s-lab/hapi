import { createReadStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { ImportableSessionAgent, ImportableSessionSummary, ListImportableSessionsRequest, ListImportableSessionsResponse } from '@hapi/protocol/apiTypes'
import { logger } from '@/ui/logger'
import { RawJSONLinesSchema, type RawJSONLines } from '@/claude/types'
import { isClaudeChatVisibleMessage } from '@/claude/utils/chatVisibility'

type JsonRecord = Record<string, unknown>
const SCAN_WINDOW_SIZE = 50
const listedSessions = new Map<string, ImportableSessionSummary>()
const listedSessionPaths = new Map<string, string>()
type FileSnapshot = { id: string; root: string; iterator: AsyncGenerator<string>; files: Array<{ path: string; modifiedAt: number }>; done: boolean }
const fileSnapshots = new Map<string, FileSnapshot>()

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

async function* iterateJsonlFiles(root: string): AsyncGenerator<string> {
    let entries
    try {
        entries = await readdir(root, { withFileTypes: true })
    } catch {
        return
    }
    entries.sort((left, right) => right.name.localeCompare(left.name))
    for (const entry of entries) {
        const path = join(root, entry.name)
        if (entry.isDirectory()) yield* iterateJsonlFiles(path)
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield path
    }
}

async function fillSnapshot(snapshot: FileSnapshot, requiredCount: number): Promise<void> {
    while (!snapshot.done && snapshot.files.length < requiredCount) {
        const next = await snapshot.iterator.next()
        if (next.done) {
            snapshot.done = true
            break
        }
        try {
            snapshot.files.push({ path: next.value, modifiedAt: (await stat(next.value)).mtimeMs })
        } catch (error) {
            logger.warn(`Skipping vanished import transcript ${next.value}`, error)
        }
    }
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

export function realClaudeUserText(input: unknown): string | null {
    const value = record(input)
    if (!value) return null
    if (value.type !== 'user' || value.isMeta === true || value.isSidechain === true || value.isCompactSummary === true) return null
    const message = record(value.message)
    const valueText = text(message?.content).trim()
    if (!valueText || /^<(task-notification|command-name|local-command-caveat|system-reminder|command-message|command-args)>/.test(valueText)) return null
    return valueText
}

function hasClaudeToolResult(message: Extract<RawJSONLines, { type: 'user' }>): boolean {
    return Array.isArray(message.message.content) && message.message.content.some((block) => (
        block !== null && typeof block === 'object' && !Array.isArray(block)
        && (block as Record<string, unknown>).type === 'tool_result'
    ))
}

export function replayableClaudeMessage(input: unknown): RawJSONLines | null {
    const parsed = RawJSONLinesSchema.safeParse(input)
    if (!parsed.success) return null
    const message = parsed.data
    if (message.type === 'summary' || message.isMeta || message.isCompactSummary) return null
    if (!isClaudeChatVisibleMessage(message)) return null
    if (message.type === 'user') {
        if (message.isSidechain) return null
        if (!hasClaudeToolResult(message) && realClaudeUserText(message) === null) return null
    }
    return message
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
        if (replayableClaudeMessage(value)) visibleMessages += 1
        const userText = realClaudeUserText(value)
        if (userText) {
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
    if (!valueText || isSyntheticCodexUserText(valueText)) return null
    return valueText
}

export function isSyntheticCodexUserText(value: string): boolean {
    return /^<(user_instructions|environment_context|user_action)>/.test(value.trimStart())
}

function legacyCodexUserText(value: JsonRecord): string | null {
    if (value.type !== 'event_msg') return null
    const payload = record(value.payload)
    if (payload?.type !== 'user_message') return null
    const valueText = text(payload.message ?? payload.text ?? payload.content).trim()
    if (!valueText || isSyntheticCodexUserText(valueText)) return null
    return valueText
}

function inferCodexSessionIdFromPath(path: string): string | null {
    return /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/.exec(path)?.[1] ?? null
}

async function scanCodex(path: string): Promise<ImportableSessionSummary | null> {
    let externalSessionId: string | null = null
    let cwd: string | null = null
    let cliVersion: string | null = null
    let timestamp: number | null = null
    let title: string | null = null
    let firstPrompt: string | null = null
    let lastPrompt: string | null = null
    let modernVisibleMessages = 0
    let legacyVisibleMessages = 0
    let legacyFirstPrompt: string | null = null
    let legacyLastPrompt: string | null = null
    let child = false
    await forEachJsonLine(path, (value) => {
        const payload = record(value.payload)
        if (!cwd && typeof value.cwd === 'string') cwd = value.cwd
        if (value.type === 'session_meta' && payload) {
            if (typeof payload.id === 'string') externalSessionId = payload.id
            if (typeof payload.cwd === 'string') cwd = payload.cwd
            if (typeof payload.cli_version === 'string') cliVersion = payload.cli_version
            if (typeof payload.timestamp === 'string') timestamp = Date.parse(payload.timestamp)
            const source = record(payload.source)
            child ||= Boolean(source && 'subagent' in source)
        }
        if (value.type === 'session_title_change' && typeof value.title === 'string') title = preview(value.title)
        if (value.type === 'response_item' && payload?.type === 'message' && payload.role === 'assistant') modernVisibleMessages += 1
        if (value.type === 'event_msg' && payload?.type === 'agent_message') legacyVisibleMessages += 1
        const userText = codexUserText(value)
        if (userText) {
            modernVisibleMessages += 1
            firstPrompt ??= preview(userText)
            lastPrompt = preview(userText)
        }
        const legacyUserText = legacyCodexUserText(value)
        if (legacyUserText) {
            legacyVisibleMessages += 1
            legacyFirstPrompt ??= preview(legacyUserText)
            legacyLastPrompt = preview(legacyUserText)
        }
    })
    const usesModernChat = modernVisibleMessages > 0
    const visibleMessages = usesModernChat ? modernVisibleMessages : legacyVisibleMessages
    if (!usesModernChat) {
        firstPrompt = legacyFirstPrompt
        lastPrompt = legacyLastPrompt
    }
    externalSessionId ??= inferCodexSessionIdFromPath(path)
    if (!externalSessionId || !cwd || child || visibleMessages === 0) return null
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
    let snapshot: FileSnapshot
    let offset: number
    if (request.cursor === undefined) {
        snapshot = { id: randomUUID(), root, iterator: iterateJsonlFiles(root), files: [], done: false }
        fileSnapshots.set(snapshot.id, snapshot)
        offset = 0
    } else {
        const separator = request.cursor.lastIndexOf(':')
        const snapshotId = request.cursor.slice(0, separator)
        offset = Number.parseInt(request.cursor.slice(separator + 1), 10)
        const active = fileSnapshots.get(snapshotId)
        if (!active || active.root !== root) throw new Error('Expired importable session cursor')
        snapshot = active
    }
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid importable session cursor')
    await fillSnapshot(snapshot, offset + SCAN_WINDOW_SIZE + 1)
    const window = snapshot.files.slice(offset, offset + SCAN_WINDOW_SIZE)
    const sessions: ImportableSessionSummary[] = []
    for (const { path } of window) {
        let summary: ImportableSessionSummary | null
        try {
            summary = agent === 'claude' ? await scanClaude(path) : await scanCodex(path)
        } catch (error) {
            logger.warn(`Skipping unreadable import transcript ${path}`, error)
            continue
        }
        if (summary) {
            sessions.push(summary)
            listedSessions.set(sessionKey(agent, summary.externalSessionId), summary)
            listedSessionPaths.set(sessionKey(agent, summary.externalSessionId), path)
        }
    }
    sessions.sort((left, right) => right.timestamp - left.timestamp)
    const nextOffset = offset + window.length
    const nextCursor = nextOffset < snapshot.files.length || !snapshot.done ? `${snapshot.id}:${nextOffset}` : null
    if (nextCursor === null) fileSnapshots.delete(snapshot.id)
    return { sessions, nextCursor }
}

export function resolveImportableSession(agent: ImportableSessionAgent, externalSessionId: string): ImportableSessionSummary | null {
    return listedSessions.get(sessionKey(agent, externalSessionId)) ?? null
}

export function resolveImportableSessionPath(agent: ImportableSessionAgent, externalSessionId: string): string | null {
    return listedSessionPaths.get(sessionKey(agent, externalSessionId)) ?? null
}
