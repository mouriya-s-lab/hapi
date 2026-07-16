import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { ImportableSessionSummary, ListImportableSessionsResponse } from '@hapi/protocol/apiTypes'
import type { ListImportableSessionsRequest } from '@hapi/protocol/apiTypes'
import { run as runRipgrep } from '@/modules/ripgrep'

const PAGE_SIZE = 50

type Cursor = { updatedAt: number; externalSessionId: string }
type Candidate = Cursor & { path: string }

function encodeCursor(cursor: Cursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeCursor(value: string): Cursor {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid Claude session cursor')
    const record = parsed as Record<string, unknown>
    if (typeof record.updatedAt !== 'number' || typeof record.externalSessionId !== 'string') throw new Error('Invalid Claude session cursor')
    return { updatedAt: record.updatedAt, externalSessionId: record.externalSessionId }
}

function isAfterCursor(candidate: Candidate, cursor: Cursor): boolean {
    return candidate.updatedAt < cursor.updatedAt
        || (candidate.updatedAt === cursor.updatedAt && candidate.externalSessionId.localeCompare(cursor.externalSessionId) < 0)
}

function extractText(content: unknown): string {
    if (typeof content === 'string') return content.trim()
    if (!Array.isArray(content)) return ''
    return content.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const record = item as Record<string, unknown>
        return record.type === 'text' && typeof record.text === 'string' ? [record.text] : []
    }).join('\n').trim()
}

function isSyntheticUserText(value: string): boolean {
    return /^<(task-notification|command-name|local-command-caveat|system-reminder|command-message|command-args)>/.test(value)
}

async function summarize(path: string, updatedAt: number): Promise<ImportableSessionSummary> {
    let cwd: string | null = null
    let title: string | null = null
    let preview: string | null = null
    const input = createReadStream(path, { encoding: 'utf8' })
    const lines = createInterface({ input, crlfDelay: Infinity })
    try {
        for await (const line of lines) {
            if (!line) continue
            const value: unknown = JSON.parse(line)
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid Claude transcript record: ${path}`)
            const record = value as Record<string, unknown>
            if (!cwd && typeof record.cwd === 'string') cwd = record.cwd
            if (record.type === 'ai-title' && typeof record.title === 'string' && record.title.trim()) title = record.title.trim()
            if (!preview && record.type === 'user' && record.isMeta !== true && record.isSidechain !== true) {
                const message = record.message && typeof record.message === 'object' && !Array.isArray(record.message)
                    ? record.message as Record<string, unknown>
                    : null
                const text = extractText(message?.content)
                if (text && !isSyntheticUserText(text)) preview = text
            }
        }
    } finally {
        lines.close()
        input.destroy()
    }
    if (!cwd) throw new Error(`Claude transcript has no cwd: ${path}`)
    const externalSessionId = basename(path, '.jsonl')
    return {
        provider: 'claude', externalSessionId, cwd,
        title: (title ?? preview ?? externalSessionId).slice(0, 160),
        preview: preview?.slice(0, 160) ?? null,
        updatedAt
    }
}

export async function resolveImportableClaudeSession(externalSessionId: string): Promise<ImportableSessionSummary | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(externalSessionId)) {
        throw new Error('Invalid Claude session ID')
    }
    const root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
    for (const project of await readdir(root, { withFileTypes: true })) {
        if (!project.isDirectory()) continue
        const fileName = `${externalSessionId}.jsonl`
        const entry = (await readdir(join(root, project.name), { withFileTypes: true })).find((candidate) => candidate.name === fileName)
        if (!entry?.isFile()) continue
        const path = join(root, project.name, fileName)
        return await summarize(path, (await stat(path)).mtimeMs)
    }
    return null
}

async function matchingTranscriptPaths(root: string, cwd?: string, query?: string): Promise<Set<string> | null> {
    const patterns = [query, cwd ? JSON.stringify({ cwd }).slice(1, -1) : undefined].filter((value): value is string => Boolean(value))
    if (patterns.length === 0) return null
    let matches: Set<string> | null = null
    for (const pattern of patterns) {
        const result = await runRipgrep(['--files-with-matches', '--fixed-strings', '--glob', '*.jsonl', '--glob', '!**/subagents/**', '--', pattern, root])
        if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error(result.stderr.trim() || 'Failed to search Claude sessions')
        const paths = new Set(result.stdout.split('\n').filter(Boolean))
        if (matches === null) matches = paths
        else for (const path of matches) if (!paths.has(path)) matches.delete(path)
        if (matches.size === 0) return matches
    }
    return matches
}

export async function listImportableClaudeSessions(request: ListImportableSessionsRequest): Promise<ListImportableSessionsResponse> {
    const root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
    const cursor = request.cursor ? decodeCursor(request.cursor) : null
    const matches = await matchingTranscriptPaths(root, request.cwd, request.query)
    const candidates: Candidate[] = []
    for (const project of await readdir(root, { withFileTypes: true })) {
        if (!project.isDirectory()) continue
        const projectPath = join(root, project.name)
        for (const entry of await readdir(projectPath, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
            const path = join(projectPath, entry.name)
            if (matches && !matches.has(path)) continue
            const candidate = { path, externalSessionId: basename(entry.name, '.jsonl'), updatedAt: (await stat(path)).mtimeMs }
            if (!cursor || isAfterCursor(candidate, cursor)) candidates.push(candidate)
        }
    }
    candidates.sort((left, right) => right.updatedAt - left.updatedAt || right.externalSessionId.localeCompare(left.externalSessionId))
    const page = candidates.slice(0, PAGE_SIZE)
    const sessions = []
    for (const candidate of page) sessions.push(await summarize(candidate.path, candidate.updatedAt))
    const last = page.at(-1)
    return {
        sessions,
        nextCursor: candidates.length > page.length && last
            ? encodeCursor({ updatedAt: last.updatedAt, externalSessionId: last.externalSessionId })
            : null
    }
}
