/**
 * Gate for harness/ACP resume → hub thinking (#1470 / #1502 / #1503).
 *
 * Returns:
 * - `true` — foreground ACP state (`running` / `requires_action`)
 * - `false` — ACP v2 `state_update: idle` (clear thinking)
 * - `null` — noise / background updates (do not touch)
 *
 * ACP allows `tool_call*` / message chunks while the agent reports `idle`
 * (background activity). Mapping those onto hub thinking races idle clears and
 * flickers the session-list spinner (#1502 residual on long-lived Cursor ACP).
 * Foreground work is `state_update` only; permission bumps go through
 * `setAgentActivityListener(true)` directly.
 *
 * `running` chatter is debounced in `AcpSdkBackend.notifyAgentActivity` so
 * rapid running↔idle edges do not flip the spinner.
 */
export type SessionUpdateThinkingHint = boolean | null

export function thinkingHintFromSessionUpdate(
    update: { sessionUpdate?: unknown; state?: unknown } | null | undefined
): SessionUpdateThinkingHint {
    if (!update || typeof update.sessionUpdate !== 'string') {
        return null
    }

    if (update.sessionUpdate !== 'state_update') {
        return null
    }

    if (update.state === 'idle') {
        return false
    }
    if (update.state === 'running' || update.state === 'requires_action') {
        return true
    }
    return null
}

/** @deprecated Prefer thinkingHintFromSessionUpdate; kept for call-site clarity in tests. */
export function shouldBumpThinkingFromSessionUpdate(
    update: { sessionUpdate?: unknown; state?: unknown } | null | undefined
): boolean {
    return thinkingHintFromSessionUpdate(update) === true
}
