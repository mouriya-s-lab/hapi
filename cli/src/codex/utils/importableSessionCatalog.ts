import type { ListImportableSessionsRequest, ListImportableSessionsResponse } from '@hapi/protocol/apiTypes'
import { CodexAppServerClient } from '../codexAppServerClient'
import { run as runRipgrep } from '@/modules/ripgrep'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const PAGE_SIZE = 50

async function matchingThreadIds(query: string | undefined): Promise<Set<string> | null> {
    if (!query) return null
    const root = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
    const result = await runRipgrep(['--files-with-matches', '--fixed-strings', '--glob', '*.jsonl', '--', query, root])
    if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error(result.stderr.trim() || 'Failed to search Codex sessions')
    const ids = result.stdout.split('\n').flatMap((path) => basename(path).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? [])
    return new Set(ids)
}

export async function listImportableCodexSessions(request: ListImportableSessionsRequest): Promise<ListImportableSessionsResponse> {
    const client = new CodexAppServerClient()
    try {
        await client.connect()
        await client.initialize({
            clientInfo: { name: 'hapi-importable-sessions', version: '1.0.0' },
            capabilities: { experimentalApi: true }
        })
        const matches = await matchingThreadIds(request.query)
        const threads = []
        let cursor = request.cursor ?? null
        let nextCursor: string | null = null
        do {
            const response = await client.listThreads({
                cursor,
                limit: PAGE_SIZE - threads.length,
                archived: false,
                cwd: request.cwd ?? null,
                sortKey: 'updated_at',
                sortDirection: 'desc',
                useStateDbOnly: true
            })
            threads.push(...response.data.filter((thread) => !matches || matches.has(thread.id)))
            nextCursor = response.nextCursor ?? null
            cursor = nextCursor
        } while (threads.length < PAGE_SIZE && nextCursor)
        return {
            sessions: threads.map((thread) => ({
                provider: 'codex' as const,
                externalSessionId: thread.id,
                cwd: thread.cwd,
                title: thread.name?.trim() || thread.preview?.trim() || thread.id,
                preview: thread.preview?.trim() || null,
                updatedAt: thread.updatedAt
            })),
            nextCursor
        }
    } finally {
        await client.disconnect()
    }
}

export async function resolveImportableCodexSession(externalSessionId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(externalSessionId)) {
        throw new Error('Invalid Codex session ID')
    }
    const client = new CodexAppServerClient()
    try {
        await client.connect()
        await client.initialize({ clientInfo: { name: 'hapi-importable-sessions', version: '1.0.0' }, capabilities: { experimentalApi: true } })
        const response = await client.readThreadMetadata(externalSessionId)
        const thread = response.thread as typeof response.thread & { name?: string | null; preview?: string | null; updatedAt?: number }
        return {
            provider: 'codex' as const,
            externalSessionId: thread.id,
            cwd: thread.cwd,
            title: thread.name?.trim() || thread.preview?.trim() || thread.id,
            preview: thread.preview?.trim() || null,
            updatedAt: thread.updatedAt ?? 0
        }
    } finally {
        await client.disconnect()
    }
}
