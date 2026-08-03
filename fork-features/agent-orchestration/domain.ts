import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import {
    extractAssistantPlainText,
    isObject,
    unwrapRoleWrappedRecordEnvelope,
    type DecryptedMessage,
    type MessagesResponse,
    type Session
} from '@hapi/protocol'
import type {
    AgentProjectedMessage,
    AgentSessionDetails,
    AgentSessionSummary,
    AgentStatus
} from './protocol'

const SUMMARY_LIMIT = 240

function pendingRequestEntry(session: Session): [string, { tool: string; arguments: unknown }] | undefined {
    const requests = session.agentState?.requests ?? {}
    const completed = session.agentState?.completedRequests ?? {}
    return Object.entries(requests).find(([requestId]) => !(requestId in completed))
}

export function deriveAgentStatus(session: Session): AgentStatus {
    if (!session.active) return 'dead'
    if (pendingRequestEntry(session)) return 'blocked'
    if (session.thinking) return 'working'
    return 'idle'
}

function normalizePath(path: string): string | null {
    if (!isAbsolute(path)) return null
    const absolutePath = resolve(path)
    return existsSync(absolutePath) ? realpathSync.native(absolutePath) : absolutePath
}

function isAncestorOrSame(ancestor: string, descendant: string): boolean {
    const candidate = relative(ancestor, descendant)
    return candidate === '' || (!candidate.startsWith('..') && !isAbsolute(candidate))
}

function sessionPath(session: Session): string | null {
    const path = session.metadata?.path
    return path ? normalizePath(path) : null
}

function sessionRoot(session: Session): string | null {
    const path = session.metadata?.worktree?.basePath ?? session.metadata?.path
    return path ? normalizePath(path) : null
}

export function isSessionInAgentScope(caller: Session, target: Session): boolean {
    const callerMachineId = caller.metadata?.machineId
    const targetMachineId = target.metadata?.machineId
    if (!callerMachineId || callerMachineId !== targetMachineId) return false

    const callerPath = sessionPath(caller)
    const targetPath = sessionPath(target)
    if (!callerPath || !targetPath) return false

    if (isAncestorOrSame(callerPath, targetPath) || isAncestorOrSame(targetPath, callerPath)) {
        return true
    }

    const callerRoot = sessionRoot(caller)
    const targetRoot = sessionRoot(target)
    return callerRoot !== null && callerRoot === targetRoot
}

export function isDirectoryInAgentScope(caller: Session, directory: string): boolean {
    const callerPath = sessionPath(caller)
    const targetPath = normalizePath(directory)
    if (!callerPath || !targetPath) return false

    if (isAncestorOrSame(callerPath, targetPath) || isAncestorOrSame(targetPath, callerPath)) {
        return true
    }

    return sessionRoot(caller) === targetPath
}

function truncate(value: string, limit = SUMMARY_LIMIT): string {
    const normalized = value.trim().replace(/\s+/g, ' ')
    return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`
}

function stringifySummary(value: unknown): string {
    if (typeof value === 'string') return truncate(value)
    try {
        return truncate(JSON.stringify(value))
    } catch {
        return '[unserializable]'
    }
}

function projectedBase(message: DecryptedMessage): Pick<AgentProjectedMessage, 'seq' | 'createdAt'> {
    return { seq: message.seq, createdAt: message.createdAt }
}

function hiddenAgentRecord(content: unknown): boolean {
    if (!isObject(content)) return false
    const data = isObject(content.data) ? content.data : null
    const message = data && isObject(data.message) ? data.message : null
    const subtype = data?.subtype ?? content.subtype
    return Boolean(content.isMeta)
        || Boolean(content.isCompactSummary)
        || Boolean(content.isSidechain)
        || Boolean(data?.isMeta)
        || Boolean(data?.isCompactSummary)
        || Boolean(data?.isSidechain)
        || Boolean(message?.isMeta)
        || Boolean(message?.isCompactSummary)
        || Boolean(message?.isSidechain)
        || subtype === 'turn_duration'
        || subtype === 'compact_boundary'
        || subtype === 'microcompact_boundary'
}

function textFromUserContent(content: unknown): string | null {
    if (typeof content === 'string') return content
    if (!isObject(content)) return null
    if (content.type === 'text' && typeof content.text === 'string') return content.text
    if (!Array.isArray(content)) return null

    const parts = content.flatMap((block) =>
        isObject(block) && block.type === 'text' && typeof block.text === 'string'
            ? [block.text]
            : []
    )
    return parts.length > 0 ? parts.join('\n') : null
}

function toolProjection(message: DecryptedMessage, content: unknown): AgentProjectedMessage | null {
    if (!isObject(content)) return null
    const data = isObject(content.data) ? content.data : null

    if (content.type === 'codex' && data?.type === 'tool-call') {
        return {
            ...projectedBase(message),
            kind: 'tool',
            name: typeof data.name === 'string' ? data.name : 'tool',
            summary: stringifySummary(data.input)
        }
    }
    if (content.type === 'codex' && data?.type === 'tool-call-result') {
        return {
            ...projectedBase(message),
            kind: 'tool',
            name: 'tool-result',
            summary: stringifySummary(data.output)
        }
    }
    if (content.type !== 'output' || !data) return null

    if (data.type === 'tool_use') {
        return {
            ...projectedBase(message),
            kind: 'tool',
            name: typeof data.name === 'string' ? data.name : 'tool',
            summary: stringifySummary(data.input)
        }
    }
    if (data.type === 'tool_result') {
        return {
            ...projectedBase(message),
            kind: 'tool',
            name: 'tool-result',
            summary: stringifySummary(data.content)
        }
    }

    const rawMessage = isObject(data.message) ? data.message : null
    const blocks = Array.isArray(rawMessage?.content) ? rawMessage.content : []
    const tools = blocks.filter((block) => isObject(block) && (block.type === 'tool_use' || block.type === 'tool_result'))
    if (tools.length === 0) return null

    const first = tools[0]
    if (!isObject(first)) return null
    return {
        ...projectedBase(message),
        kind: 'tool',
        name: first.type === 'tool_use' && typeof first.name === 'string' ? first.name : 'tool-result',
        summary: stringifySummary(first.type === 'tool_use' ? first.input : first.content)
    }
}

export function projectAgentMessage(message: DecryptedMessage): AgentProjectedMessage | null {
    const envelope = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!envelope) {
        return {
            ...projectedBase(message),
            kind: 'other',
            summary: stringifySummary(message.content)
        }
    }

    if (envelope.role === 'user') {
        const text = textFromUserContent(envelope.content)
        if (text) {
            const meta = isObject(envelope.meta) ? envelope.meta : null
            return {
                ...projectedBase(message),
                kind: 'user',
                text,
                ...(typeof meta?.sentFrom === 'string' ? { sentFrom: meta.sentFrom } : {}),
                ...(typeof meta?.fromSessionId === 'string' ? { fromSessionId: meta.fromSessionId } : {})
            }
        }
    }

    if (hiddenAgentRecord(envelope.content)) return null

    const assistantText = extractAssistantPlainText(envelope.content)
    if (assistantText) {
        return {
            ...projectedBase(message),
            kind: 'assistant',
            text: assistantText
        }
    }

    const tool = toolProjection(message, envelope.content)
    if (tool) return tool

    return {
        ...projectedBase(message),
        kind: 'other',
        summary: stringifySummary(envelope.content)
    }
}

export function projectAgentMessages(response: MessagesResponse): {
    raw: false
    messages: AgentProjectedMessage[]
    page: MessagesResponse['page']
} {
    return {
        raw: false,
        messages: response.messages.flatMap((message) => {
            const projected = projectAgentMessage(message)
            return projected ? [projected] : []
        }),
        page: response.page
    }
}

export function toAgentSessionSummary(session: Session): AgentSessionSummary | null {
    const metadata = session.metadata
    if (!metadata?.path || !metadata.machineId) return null
    return {
        id: session.id,
        ...(metadata.name ? { name: metadata.name } : {}),
        flavor: metadata.flavor ?? null,
        path: metadata.path,
        machineId: metadata.machineId,
        status: deriveAgentStatus(session),
        updatedAt: session.updatedAt
    }
}

export function toAgentSessionDetails(session: Session): AgentSessionDetails | null {
    const summary = toAgentSessionSummary(session)
    if (!summary) return null

    const pending = pendingRequestEntry(session)?.[1]
    return {
        ...summary,
        ...(session.metadata?.worktree ? { worktree: session.metadata.worktree } : {}),
        model: session.model ?? null,
        ...(session.permissionMode ? { permissionMode: session.permissionMode } : {}),
        ...(pending ? {
            pendingRequest: {
                tool: pending.tool,
                summary: stringifySummary(pending.arguments)
            }
        } : {})
    }
}
