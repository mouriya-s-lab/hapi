import { bootstrapSession } from '../../../cli/src/agent/sessionFactory'
import { isClaudeChatVisibleMessage } from '../../../cli/src/claude/utils/chatVisibility'
import { resolveImportableClaudeSession } from './claudeCatalog'
import { RawJSONLinesSchema } from '../../../cli/src/claude/types'
import { CodexAppServerClient } from '../../../cli/src/codex/codexAppServerClient'
import { convertCodexEvent, type CodexSessionEvent } from '../../../cli/src/codex/utils/codexEventConverter'
import type { ImportProviderSessionRequest, ImportProviderSessionResponse } from '@hapi/protocol/apiTypes'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

function isSyntheticCodexUserMessage(value: string): boolean {
    const text = value.trimStart()
    return text.startsWith('# AGENTS.md instructions')
        || text.startsWith('<environment_context>')
        || text.startsWith('<user_instructions>')
}

async function resolveCodexTranscriptPath(externalSessionId: string): Promise<{ cwd: string; path: string; title: string } | null> {
    const client = new CodexAppServerClient()
    try {
        await client.connect()
        await client.initialize({
            clientInfo: { name: 'hapi-history-import', version: '1.0.0' },
            capabilities: { experimentalApi: true }
        })
        const response = await client.readThreadMetadata(externalSessionId)
        const thread = response.thread as typeof response.thread & { path?: string | null; name?: string | null; preview?: string | null }
        return thread.path ? {
            cwd: thread.cwd,
            path: thread.path,
            title: thread.name?.trim() || thread.preview?.trim() || thread.id
        } : null
    } finally {
        await client.disconnect()
    }
}

async function replayCodexHistory(path: string, send: {
    user: (text: string) => void
    agent: (message: unknown) => void
    activity: () => void
}): Promise<number> {
    const input = createReadStream(path, { encoding: 'utf8' })
    const lines = createInterface({ input, crlfDelay: Infinity })
    let messageCount = 0
    try {
        for await (const line of lines) {
            if (!line.trim()) continue
            const value: unknown = JSON.parse(line)
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Codex transcript line is not an object')
            const record = value as Record<string, unknown>
            if (typeof record.type !== 'string') throw new Error('Codex transcript event has no type')
            const event: CodexSessionEvent = {
                timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
                type: record.type,
                payload: record.payload
            }
            const converted = convertCodexEvent(event)
            if (converted?.userMessage && !isSyntheticCodexUserMessage(converted.userMessage)) {
                send.user(converted.userMessage)
                messageCount += 1
            } else if (converted?.userActivity) {
                send.activity()
            }
            for (const message of converted?.messages ?? []) {
                send.agent(message)
                messageCount += 1
            }
        }
    } finally {
        lines.close()
        input.destroy()
    }
    return messageCount
}

async function replayClaudeHistory(path: string, send: (message: ReturnType<typeof RawJSONLinesSchema.parse>) => void): Promise<number> {
    const input = createReadStream(path, { encoding: 'utf8' })
    const lines = createInterface({ input, crlfDelay: Infinity })
    let messageCount = 0
    try {
        for await (const line of lines) {
            if (!line.trim()) continue
            const parsed = RawJSONLinesSchema.safeParse(JSON.parse(line) as unknown)
            if (!parsed.success) continue
            const message = parsed.data
            if (message.type === 'summary' || message.isMeta || message.isCompactSummary || message.isSidechain) continue
            if (!isClaudeChatVisibleMessage(message)) continue
            send(message)
            messageCount += 1
        }
    } finally {
        lines.close()
        input.destroy()
    }
    return messageCount
}

export async function importProviderSession(request: ImportProviderSessionRequest): Promise<ImportProviderSessionResponse> {
    const codexSource = request.provider === 'codex'
        ? await resolveCodexTranscriptPath(request.externalSessionId)
        : null
    const claudeSource = request.provider === 'claude'
        ? await resolveImportableClaudeSession(request.externalSessionId)
        : null
    if (!codexSource && !claudeSource) return { type: 'not-found' }

    const workingDirectory = codexSource?.cwd ?? claudeSource!.cwd
    const bootstrap = await bootstrapSession({
        flavor: request.provider,
        startedBy: 'terminal',
        workingDirectory,
        metadataOverrides: { name: codexSource?.title ?? claudeSource!.title }
    })

    try {
        let messageCount = 0
        if (request.provider === 'codex') {
            messageCount = await replayCodexHistory(codexSource!.path, {
                user: (text) => bootstrap.session.sendUserMessage(text),
                agent: (message) => bootstrap.session.sendAgentMessage(message),
                activity: () => bootstrap.session.notifyUserActivity()
            })
        } else {
            messageCount = await replayClaudeHistory(
                claudeSource!.path,
                (message) => bootstrap.session.sendClaudeSessionMessage(message)
            )
        }

        bootstrap.session.updateMetadata((metadata) => ({
            ...metadata,
            ...(request.provider === 'codex'
                ? { codexSessionId: request.externalSessionId }
                : { claudeSessionId: request.externalSessionId })
        }))
        await bootstrap.session.flush({ timeoutMs: 30_000 })
        bootstrap.session.sendSessionDeath('completed')
        await bootstrap.session.flush({ timeoutMs: 30_000 })
        return { type: 'success', sessionId: bootstrap.sessionInfo.id, messageCount }
    } catch (error) {
        bootstrap.session.sendSessionDeath('error')
        await bootstrap.session.flush({ timeoutMs: 30_000 })
        return {
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
            sessionId: bootstrap.sessionInfo.id
        }
    } finally {
        bootstrap.session.close()
    }
}
