import type { AgentEvent } from '@/chat/types'

type OmpEventPresentation = {
    icon: string | null
    text: string
}

type CompactionOutcome = 'completed' | 'aborted' | 'skipped' | 'failed'

type ArchiveSummary = {
    frameCount: number
    totalChars: number
    truncatedChars: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object'
        ? value as Record<string, unknown>
        : null
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asNonnegativeNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function truncate(text: string, maxLength: number = 180): string {
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`
}

function formatCount(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    if (value >= 1_000) return `${Math.round(value / 1_000)}k`
    return String(value)
}

function formatEventText(label: string, details: Array<string | null | undefined>): string {
    return [label, ...details].filter((detail): detail is string => Boolean(detail)).join(' · ')
}

function formatTtsrTriggeredEvent(frame: Record<string, unknown> | null): OmpEventPresentation {
    const rules = Array.isArray(frame?.rules) ? frame.rules : []
    const ruleNames: string[] = []
    for (const rule of rules) {
        const name = asString(asRecord(rule)?.name)
        if (name && !ruleNames.includes(name)) ruleNames.push(name)
    }

    if (ruleNames.length === 0) {
        return { icon: '⚠️', text: 'Injecting rule' }
    }
    if (ruleNames.length === 1) {
        return { icon: '⚠️', text: `Injecting rule: ${ruleNames[0]}` }
    }

    const visibleRuleNames = ruleNames.slice(0, 4)
    const hiddenRuleCount = ruleNames.length - visibleRuleNames.length
    return {
        icon: '⚠️',
        text: formatEventText(
            `Injecting ${ruleNames.length} rules: ${visibleRuleNames.join(', ')}`,
            [hiddenRuleCount > 0 ? `+${hiddenRuleCount} more` : null]
        )
    }
}

function formatIrcMessageEvent(frame: Record<string, unknown> | null): OmpEventPresentation {
    const message = asRecord(frame?.message)
    const details = asRecord(message?.details)
    const from = asString(details?.from)
    const preview = asString(details?.message)
        ?? asString(typeof message?.content === 'string' ? message.content : null)
    return {
        icon: '💬',
        text: formatEventText(
            from ? `Message from ${from}` : 'Agent message',
            [preview ? truncate(preview) : null]
        )
    }
}

function formatTodoReminderEvent(frame: Record<string, unknown> | null): OmpEventPresentation {
    const todos = Array.isArray(frame?.todos) ? frame.todos : []
    const open: string[] = []
    for (const todo of todos) {
        const record = asRecord(todo)
        const status = asString(record?.status)
        const content = asString(record?.content)
        if (!content) continue
        if (status === 'completed' || status === 'abandoned') continue
        if (!open.includes(content)) open.push(content)
    }
    const attempt = asNonnegativeNumber(frame?.attempt)
    const maxAttempts = asNonnegativeNumber(frame?.maxAttempts)
    const attemptText = attempt !== null && maxAttempts !== null
        ? `${attempt}/${maxAttempts}`
        : null
    if (open.length === 0) {
        return { icon: '☐', text: formatEventText('Unfinished todos', [attemptText]) }
    }
    const visible = open.slice(0, 3)
    const hidden = open.length - visible.length
    return {
        icon: '☐',
        text: formatEventText(
            `Unfinished todos: ${visible.join(', ')}`,
            [hidden > 0 ? `+${hidden} more` : null, attemptText]
        )
    }
}

function formatGoalUpdatedEvent(frame: Record<string, unknown> | null): OmpEventPresentation {
    const goal = asRecord(frame?.goal)
    if (!goal) return { icon: null, text: 'Goal cleared' }
    const status = asString(goal.status)
    const objective = asString(goal.objective)
    return {
        icon: null,
        text: formatEventText(
            status ? `Goal ${status}` : 'Goal updated',
            [objective ? truncate(objective) : null]
        )
    }
}

function formatSessionEvent(event: Record<string, unknown>): OmpEventPresentation {
    const eventType = asString(event.eventType) ?? asString(asRecord(event.frame)?.type)
    const frame = asRecord(event.frame)
    switch (eventType) {
        case 'ttsr_triggered':
            return formatTtsrTriggeredEvent(frame)
        case 'irc_message':
            return formatIrcMessageEvent(frame)
        case 'todo_reminder':
            return formatTodoReminderEvent(frame)
        case 'todo_auto_clear':
            return { icon: '☐', text: 'Todos cleared' }
        case 'goal_updated':
            return formatGoalUpdatedEvent(frame)
        case 'model_changed':
            return { icon: '🔄', text: 'Model changed' }
        default:
            return {
                icon: null,
                text: eventType ? `OMP ${eventType.replaceAll('_', ' ')}` : 'OMP session event'
            }
    }
}

function readOutcome(event: Record<string, unknown>, frame: Record<string, unknown> | null): CompactionOutcome {
    const explicit = event.outcome
    if (explicit === 'completed' || explicit === 'aborted' || explicit === 'skipped' || explicit === 'failed') {
        return explicit
    }
    if (frame?.aborted === true) return 'aborted'
    if (frame?.skipped === true) return 'skipped'
    if (asString(frame?.errorMessage)) return 'failed'
    return 'completed'
}

function readArchive(result: Record<string, unknown> | null): ArchiveSummary | null {
    const directArchive = asRecord(result?.archive)
    const preserveData = asRecord(result?.preserveData)
    const legacyArchive = asRecord(preserveData?.snapcompact)
    const archive = directArchive ?? legacyArchive
    if (!archive) return null

    const frameCount = asNonnegativeNumber(archive.frameCount)
        ?? (Array.isArray(archive.frames) ? archive.frames.length : null)
    const totalChars = asNonnegativeNumber(archive.totalChars)
    const truncatedChars = asNonnegativeNumber(archive.truncatedChars) ?? 0
    if (frameCount === null || totalChars === null) return null
    return { frameCount, totalChars, truncatedChars }
}

export function getOmpEventPresentation(event: AgentEvent): OmpEventPresentation | null {
    const record = event as Record<string, unknown>
    if (event.type === 'omp-session-event') return formatSessionEvent(record)
    if (event.type === 'omp-rpc-warning' && record.eventType === 'model_changed') {
        return { icon: '🔄', text: 'Model changed' }
    }
    if (event.type === 'omp-command-output') {
        const text = asString(record.text)
        return { icon: null, text: text ? truncate(text) : 'OMP command output' }
    }
    if (event.type !== 'omp-compaction') return null

    const frame = asRecord(record.frame)
    const phase = asString(record.phase)
    const action = asString(record.action) ?? asString(frame?.action)

    if (phase === 'started') {
        const reason = asString(record.reason) ?? asString(frame?.reason)
        return {
            icon: '◷',
            text: formatEventText('Compacting conversation', [action, reason?.replaceAll('-', ' ')])
        }
    }

    if (phase !== 'finished') {
        return { icon: null, text: 'Conversation compaction updated' }
    }

    const outcome = readOutcome(record, frame)
    const willRetry = record.willRetry === true || frame?.willRetry === true
    const retryText = willRetry ? 'retrying' : null
    switch (outcome) {
        case 'aborted':
            return {
                icon: '×',
                text: formatEventText('Conversation compaction cancelled', [action, retryText])
            }
        case 'skipped': {
            const message = asString(record.message) ?? asString(frame?.errorMessage)
            return {
                icon: '–',
                text: formatEventText(
                    'Conversation compaction skipped',
                    [action, message ? truncate(message) : null, retryText]
                )
            }
        }
        case 'failed': {
            const errorMessage = asString(record.errorMessage) ?? asString(frame?.errorMessage)
            return {
                icon: '!',
                text: formatEventText(
                    'Conversation compaction failed',
                    [action, errorMessage ? truncate(errorMessage) : null, retryText]
                )
            }
        }
        case 'completed':
            break
    }

    const result = asRecord(record.result) ?? asRecord(frame?.result)
    const archive = readArchive(result)
    const tokensBefore = asNonnegativeNumber(result?.tokensBefore)
    const shortSummary = asString(result?.shortSummary)
    const details: Array<string | null> = [action]
    if (archive) {
        details.push(`${formatCount(archive.totalChars)} chars archived`)
        details.push(`${archive.frameCount} ${archive.frameCount === 1 ? 'frame' : 'frames'}`)
        if (archive.truncatedChars > 0) details.push(`${formatCount(archive.truncatedChars)} chars dropped`)
    } else if (shortSummary) {
        details.push(truncate(shortSummary))
    }
    if (tokensBefore !== null) details.push(`${formatCount(tokensBefore)} tokens before`)
    details.push(retryText)

    return {
        icon: '✓',
        text: formatEventText('Conversation compacted', details)
    }
}
