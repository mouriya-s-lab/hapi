/**
 * Gate for harness/ACP resume → hub thinking (#1470).
 *
 * Returns:
 * - `true` — real agent activity / foreground running (bump thinking)
 * - `false` — ACP v2 `state_update: idle` (clear thinking)
 * - `null` — noise / unknown (do not touch thinking)
 */
export type SessionUpdateThinkingHint = boolean | null

export function thinkingHintFromSessionUpdate(
    update: { sessionUpdate?: unknown; state?: unknown } | null | undefined
): SessionUpdateThinkingHint {
    if (!update || typeof update.sessionUpdate !== 'string') {
        return null
    }

    switch (update.sessionUpdate) {
        case 'agent_message_chunk':
        case 'agent_message':
        case 'agent_thought_chunk':
        case 'agent_thought':
        case 'tool_call':
        case 'tool_call_update':
        case 'tool_call_content_chunk':
        case 'plan':
        case 'user_message':
        case 'user_message_chunk':
            return true
        case 'state_update':
            if (update.state === 'running' || update.state === 'requires_action') {
                return true
            }
            if (update.state === 'idle') {
                return false
            }
            return null
        default:
            return null
    }
}

/** @deprecated Prefer thinkingHintFromSessionUpdate; kept for call-site clarity in tests. */
export function shouldBumpThinkingFromSessionUpdate(
    update: { sessionUpdate?: unknown; state?: unknown } | null | undefined
): boolean {
    return thinkingHintFromSessionUpdate(update) === true
}
