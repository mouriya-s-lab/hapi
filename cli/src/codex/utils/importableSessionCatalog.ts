import type { ListImportableSessionsResponse } from '@hapi/protocol/apiTypes'
import { CodexAppServerClient } from '../codexAppServerClient'

const PAGE_SIZE = 50

export async function listImportableCodexSessions(cursor?: string): Promise<ListImportableSessionsResponse> {
    const client = new CodexAppServerClient()
    try {
        await client.connect()
        await client.initialize({
            clientInfo: { name: 'hapi-importable-sessions', version: '1.0.0' },
            capabilities: { experimentalApi: true }
        })
        const response = await client.listThreads({
            cursor: cursor ?? null,
            limit: PAGE_SIZE,
            archived: false,
            sortKey: 'updated_at',
            sortDirection: 'desc',
            useStateDbOnly: true
        })
        return {
            sessions: response.data.map((thread) => ({
                provider: 'codex' as const,
                externalSessionId: thread.id,
                cwd: thread.cwd,
                title: thread.name?.trim() || thread.preview?.trim() || thread.id,
                preview: thread.preview?.trim() || null,
                updatedAt: thread.updatedAt
            })),
            nextCursor: response.nextCursor ?? null
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
        const thread = response.thread as typeof response.thread & { name?: string | null; preview?: string | null; updatedAt?: number; parentThreadId?: string | null }
        if (thread.parentThreadId) return null
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
