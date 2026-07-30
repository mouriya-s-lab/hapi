import type { SessionSummary } from '@/types/api'

export type SessionAttention =
    | { kind: 'permission' }
    | { kind: 'input' }
    | { kind: 'background' }
    | { kind: 'ready' }
    | { kind: 'unread' }

export function classifySessionAttention(
    summary: SessionSummary,
    options: { selected: boolean; lastSeenAt: number }
): SessionAttention | null {
    if (options.selected || summary.thinking) {
        return null
    }

    const pendingRequestKinds = Array.isArray(summary.pendingRequestKinds)
        ? summary.pendingRequestKinds
        : []

    if (pendingRequestKinds.includes('permission')) {
        return { kind: 'permission' }
    }

    if (pendingRequestKinds.includes('input')) {
        return { kind: 'input' }
    }

    if (summary.active && (summary.backgroundTaskCount ?? 0) > 0) {
        return { kind: 'background' }
    }

    // "Ready": the agent stopped (not thinking) but the session is still alive
    // with no pending request and no background work — i.e. it finished a turn
    // and is waiting for the user. Reaching here means none of the above matched,
    // so this is an idle-but-active session. Takes precedence over 'unread' and
    // persists (independent of lastSeenAt) until the session is opened or starts
    // thinking again, so the user has a durable "go reply here" hint.
    if (summary.active) {
        return { kind: 'ready' }
    }

    if (summary.updatedAt > options.lastSeenAt) {
        return { kind: 'unread' }
    }

    return null
}

export function getSessionAttentionLabelKey(attention: SessionAttention): string {
    switch (attention.kind) {
        case 'permission':
            return 'session.item.permission'
        case 'input':
            return 'session.item.needsInput'
        case 'background':
            return 'session.item.background'
        case 'ready':
            return 'session.item.ready'
        case 'unread':
            return 'session.item.newActivity'
    }
}
