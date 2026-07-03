import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import type { SyncEngine } from '../../sync/syncEngine'
import type { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { requireMachine } from './guards'
import type {
    ImportableSessionSummary,
    ImportSessionResultItem,
    ImportSessionsResult,
    ReadImportableSessionResponse
} from '@hapi/protocol/apiTypes'

/**
 * 历史会话导入(功能1)的 hub 侧路由。
 *
 * 架构:本地会话文件只有 CLI 所在机器能读(hub 可能在 ECS)。因此:
 *  - GET  /machines/:id/importable          经 RPC 让目标机器扫描,返回可导入会话摘要
 *  - POST /machines/:id/import              经 RPC 取回选中会话的 hapi 消息,在 hub 写库
 *
 * 去重:导入产生的会话在 metadata 上记 importedFrom = {flavor, sourceId}。
 * 再次导入同一来源会话时,复用已存在的 hapi 会话(覆盖式重写消息),避免重复堆积。
 */

type ImportedSessionMeta = {
    title?: string | null
    cwd?: string | null
    cliVersion?: string | null
    modifiedAt?: number
}

function buildImportedMetadata(
    flavor: 'claude' | 'codex',
    sourceId: string,
    meta: ImportedSessionMeta,
    existing?: Record<string, unknown> | null
): Record<string, unknown> {
    const now = Date.now()
    const title = meta.title?.trim() || (flavor === 'codex' ? 'Codex 会话' : 'Claude 会话')
    const path = meta.cwd
        ?? (typeof existing?.path === 'string' ? existing.path : undefined)
    return {
        ...(existing ?? {}),
        ...(path ? { path } : {}),
        name: title,
        summary: title
            ? { text: title, updatedAt: now }
            : existing?.summary,
        flavor,
        // 标记来源,供再次导入时去重定位。
        importedFrom: { flavor, sourceId },
        // 兼容 codex 既有字段,便于复用其它逻辑。
        ...(flavor === 'codex' ? { codexSessionId: sourceId } : {}),
        lifecycleState: typeof existing?.lifecycleState === 'string' ? existing.lifecycleState : 'imported',
        lifecycleStateSince: typeof existing?.lifecycleStateSince === 'number' ? existing.lifecycleStateSince : now
    }
}

/** 在指定 namespace 下查找此前由同一来源会话导入过的 hapi 会话。 */
function findExistingImportedSession(
    store: Store,
    namespace: string,
    flavor: 'claude' | 'codex',
    sourceId: string
): string | null {
    for (const session of store.sessions.getSessionsByNamespace(namespace)) {
        const metadata = session.metadata as Record<string, unknown> | null
        const importedFrom = metadata && typeof metadata === 'object'
            ? (metadata.importedFrom as { flavor?: string; sourceId?: string } | undefined)
            : undefined
        if (importedFrom && importedFrom.flavor === flavor && importedFrom.sourceId === sourceId) {
            return session.id
        }
    }
    return null
}

type ImportResultItem = ImportSessionResultItem

export function createImportSessionsRoutes(options: {
    store: Store
    getSyncEngine: () => SyncEngine | null
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const { store, getSyncEngine } = options

    // 列出某机器上可导入的本地会话(经 RPC 让该机器扫描)。
    app.get('/machines/:id/importable', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ success: false, error: 'Not connected' }, 503)
        }
        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId, { store })
        if (machine instanceof Response) {
            return machine
        }
        try {
            const result = await engine.listImportableSessionsForMachine(machineId)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list importable sessions'
            }, 500)
        }
    })

    // 导入选中的会话:逐个经 RPC 取回消息,在 hub 写库。
    app.post('/machines/:id/import', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ success: false, error: 'Not connected' }, 503)
        }
        const machineId = c.req.param('id')
        // 触发机器扫描/读取本地文件属于操作性动作,要求 operator 以上权限。
        const machine = requireMachine(c, engine, machineId, { store, requireOperate: true })
        if (machine instanceof Response) {
            return machine
        }

        let sessions: ImportableSessionSummary[] = []
        try {
            const body = await c.req.json()
            if (Array.isArray(body?.sessions)) {
                sessions = body.sessions
            }
        } catch {
            return c.json({ success: false, error: 'Invalid request body' }, 400)
        }
        if (sessions.length === 0) {
            return c.json({ success: false, error: '未选择要导入的会话' }, 400)
        }

        const namespace = c.get('namespace')
        const results: ImportResultItem[] = []

        for (const summary of sessions) {
            const flavor = summary.flavor === 'codex' ? 'codex' : 'claude'
            const sourceId = typeof summary.id === 'string' ? summary.id : ''
            const file = typeof summary.file === 'string' ? summary.file : ''
            if (!sourceId || !file) {
                results.push({ sourceId, flavor, success: false, error: '缺少会话标识或文件路径' })
                continue
            }

            // 已导入过同一来源会话则跳过,避免重复堆积(不做覆盖,保守处理)。
            const existing = findExistingImportedSession(store, namespace, flavor, sourceId)
            if (existing) {
                results.push({ sourceId, flavor, success: true, sessionId: existing, action: 'skipped-existing' })
                continue
            }

            let read: ReadImportableSessionResponse
            try {
                read = await engine.readImportableSessionForMachine(machineId, { flavor, file, id: sourceId })
            } catch (error) {
                results.push({ sourceId, flavor, success: false, error: error instanceof Error ? error.message : '读取会话失败' })
                continue
            }
            if (!read.success || !read.messages || read.messages.length === 0) {
                results.push({ sourceId, flavor, success: false, error: read.error ?? '没有可导入的会话内容' })
                continue
            }

            try {
                const metadata = buildImportedMetadata(flavor, sourceId, read.meta ?? {})
                // 归属到发起导入的账号,否则非管理员导入后自己看不到。
                const created = engine.getOrCreateSession(randomUUID(), metadata, {}, namespace, undefined, undefined, undefined, c.get('accountId') ?? null)
                const sessionId = created.id
                let lastCreatedAt = Date.now()
                for (const message of read.messages) {
                    const stored = store.messages.addMessage(sessionId, message)
                    lastCreatedAt = stored.createdAt
                }
                engine.recordSessionActivity(sessionId, lastCreatedAt)
                results.push({
                    sourceId,
                    flavor,
                    success: true,
                    sessionId,
                    action: 'created',
                    messageCount: read.messages.length
                })
            } catch (error) {
                results.push({ sourceId, flavor, success: false, error: error instanceof Error ? error.message : '写入会话失败' })
            }
        }

        const importedCount = results.filter((r) => r.success && r.action === 'created').length
        const skippedCount = results.filter((r) => r.success && r.action === 'skipped-existing').length
        const failedCount = results.filter((r) => !r.success).length
        const response: ImportSessionsResult = {
            success: failedCount === 0,
            importedCount,
            skippedCount,
            failedCount,
            results
        }
        return c.json(response)
    })

    return app
}
