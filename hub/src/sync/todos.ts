import { isObject } from '@hapi/protocol'
import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import { TodoItemSchema, TodosSchema } from '@hapi/protocol/schemas'
import type { TodoItem } from '@hapi/protocol/types'

export { TodoItemSchema, TodosSchema }
export type { TodoItem }

function extractTodosFromClaudeOutput(content: Record<string, unknown>): TodoItem[] | null {
    if (content.type !== 'output') return null

    const data = isObject(content.data) ? content.data : null
    if (!data || data.type !== 'assistant') return null

    const message = isObject(data.message) ? data.message : null
    if (!message) return null

    const modelContent = message.content
    if (!Array.isArray(modelContent)) return null

    for (const block of modelContent) {
        if (!isObject(block) || block.type !== 'tool_use') continue
        const name = typeof block.name === 'string' ? block.name : null
        if (name !== 'TodoWrite') continue
        const input = 'input' in block ? (block as Record<string, unknown>).input : null
        if (!isObject(input)) continue

        const todosCandidate = input.todos
        const parsed = TodosSchema.safeParse(todosCandidate)
        if (parsed.success) {
            return parsed.data
        }
    }

    return null
}

function extractTodosFromCodexMessage(content: Record<string, unknown>): TodoItem[] | null {
    if (content.type !== 'codex') return null

    const data = isObject(content.data) ? content.data : null
    if (!data || data.type !== 'tool-call') return null

    const name = typeof data.name === 'string' ? data.name : null
    if (name !== 'TodoWrite') return null

    const input = 'input' in data ? (data as Record<string, unknown>).input : null
    if (!isObject(input)) return null

    const todosCandidate = input.todos
    const parsed = TodosSchema.safeParse(todosCandidate)
    return parsed.success ? parsed.data : null
}

function extractTodosFromAcpMessage(content: Record<string, unknown>): TodoItem[] | null {
    if (content.type !== 'codex') return null

    const data = isObject(content.data) ? content.data : null
    if (!data || data.type !== 'plan') return null

    const entries = data.entries
    if (!Array.isArray(entries)) return null

    const todos: TodoItem[] = []
    entries.forEach((entry, index) => {
        if (!isObject(entry)) return
        const contentValue = typeof entry.content === 'string' ? entry.content : null
        const priorityValue = typeof entry.priority === 'string' ? entry.priority : null
        const statusValue = typeof entry.status === 'string' ? entry.status : null
        if (!contentValue || !priorityValue || !statusValue) return
        if (priorityValue !== 'high' && priorityValue !== 'medium' && priorityValue !== 'low') return
        if (statusValue !== 'pending' && statusValue !== 'in_progress' && statusValue !== 'completed') return

        const idValue = typeof entry.id === 'string' ? entry.id : `plan-${index + 1}`

        todos.push({
            content: contentValue,
            priority: priorityValue,
            status: statusValue,
            id: idValue
        })
    })

    const parsed = TodosSchema.safeParse(todos)
    return parsed.success ? parsed.data : null
}

export function extractTodoWriteTodosFromMessageContent(messageContent: unknown): TodoItem[] | null {
    const record = unwrapRoleWrappedRecordEnvelope(messageContent)
    if (!record) return null

    if (record.role !== 'agent' && record.role !== 'assistant') return null

    if (!isObject(record.content) || typeof record.content.type !== 'string') return null

    return extractTodosFromClaudeOutput(record.content)
        ?? extractTodosFromCodexMessage(record.content)
        ?? extractTodosFromAcpMessage(record.content)
}

const TASK_CREATED_RESULT_PATTERN = /^Task #(\d+) created successfully: (.+)$/s

type TaskTodoStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

export type TaskTodoEvent =
    | { kind: 'create'; id: string; subject: string }
    | { kind: 'update'; taskId: string; status?: TaskTodoStatus; subject?: string; activeForm?: string }

function isTaskTodoStatus(value: unknown): value is TaskTodoStatus {
    return value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'deleted'
}

function extractToolResultText(block: Record<string, unknown>): string | null {
    if (typeof block.content === 'string') return block.content
    if (!Array.isArray(block.content)) return null

    const textBlocks = block.content.filter(
        (item): item is Record<string, unknown> => isObject(item) && item.type === 'text' && typeof item.text === 'string'
    )
    return textBlocks.length > 0 ? textBlocks.map((item) => item.text).join('\n') : null
}

export function extractTaskTodoEventsFromMessageContent(messageContent: unknown): TaskTodoEvent[] {
    const record = unwrapRoleWrappedRecordEnvelope(messageContent)
    if (!record || (record.role !== 'agent' && record.role !== 'assistant')) return []
    if (!isObject(record.content) || record.content.type !== 'output') return []

    const data = isObject(record.content.data) ? record.content.data : null
    const message = data && isObject(data.message) ? data.message : null
    if (!data || !message || !Array.isArray(message.content)) return []

    if (data.type === 'assistant') {
        return message.content.flatMap((block): TaskTodoEvent[] => {
            if (!isObject(block) || block.type !== 'tool_use' || block.name !== 'TaskUpdate') return []
            const input = isObject(block.input) ? block.input : null
            if (!input || typeof input.taskId !== 'string' || input.taskId.length === 0) return []
            return [{
                kind: 'update',
                taskId: input.taskId,
                status: isTaskTodoStatus(input.status) ? input.status : undefined,
                subject: typeof input.subject === 'string' ? input.subject : undefined,
                activeForm: typeof input.activeForm === 'string' ? input.activeForm : undefined
            }]
        })
    }

    if (data.type === 'user') {
        return message.content.flatMap((block): TaskTodoEvent[] => {
            if (!isObject(block) || block.type !== 'tool_result' || block.is_error === true) return []
            const text = extractToolResultText(block)
            const match = text ? TASK_CREATED_RESULT_PATTERN.exec(text.trim()) : null
            return match ? [{ kind: 'create', id: match[1], subject: match[2].trim() }] : []
        })
    }

    return []
}

export function applyTaskTodoEvents(existing: TodoItem[] | null | undefined, events: TaskTodoEvent[]): TodoItem[] | null {
    if (events.length === 0) return null

    const todos = (existing ?? []).map((item) => ({ ...item }))
    let changed = false

    for (const event of events) {
        if (event.kind === 'create') {
            const item = todos.find((candidate) => candidate.id === event.id)
            if (item) {
                if (item.content !== event.subject) {
                    item.content = event.subject
                    changed = true
                }
            } else {
                todos.push({ id: event.id, content: event.subject, status: 'pending', priority: 'medium' })
                changed = true
            }
            continue
        }

        const index = todos.findIndex((item) => item.id === event.taskId)
        if (index === -1) continue
        if (event.status === 'deleted') {
            todos.splice(index, 1)
            changed = true
            continue
        }

        const item = todos[index]
        if (event.status && item.status !== event.status) {
            item.status = event.status
            changed = true
        }
        if (event.subject !== undefined && item.content !== event.subject) {
            item.content = event.subject
            changed = true
        }
        if (event.activeForm !== undefined && item.activeForm !== event.activeForm) {
            item.activeForm = event.activeForm
            changed = true
        }
    }

    return changed ? TodosSchema.parse(todos) : null
}

export function applyTodoMessageContent(existing: TodoItem[] | null, messageContent: unknown): TodoItem[] | null {
    const snapshot = extractTodoWriteTodosFromMessageContent(messageContent)
    if (snapshot) return snapshot
    return applyTaskTodoEvents(existing, extractTaskTodoEventsFromMessageContent(messageContent))
}
