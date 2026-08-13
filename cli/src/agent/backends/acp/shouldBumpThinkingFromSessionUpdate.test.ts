import { describe, expect, it } from 'vitest'
import {
    shouldBumpThinkingFromSessionUpdate,
    thinkingHintFromSessionUpdate,
} from './shouldBumpThinkingFromSessionUpdate'
import { ACP_SESSION_UPDATE_TYPES } from './constants'

describe('thinkingHintFromSessionUpdate', () => {
    it.each([
        ACP_SESSION_UPDATE_TYPES.agentMessageChunk,
        ACP_SESSION_UPDATE_TYPES.agentThoughtChunk,
        ACP_SESSION_UPDATE_TYPES.toolCall,
        ACP_SESSION_UPDATE_TYPES.toolCallUpdate,
        ACP_SESSION_UPDATE_TYPES.plan,
        'agent_message',
        'agent_thought',
        'user_message',
        'user_message_chunk',
        'tool_call_content_chunk',
    ] as const)('ignores background/content type %s (not foreground state)', (sessionUpdate) => {
        expect(thinkingHintFromSessionUpdate({ sessionUpdate })).toBeNull()
        expect(shouldBumpThinkingFromSessionUpdate({ sessionUpdate })).toBe(false)
    })

    it('returns true for state_update running/requires_action (debounced in backend)', () => {
        expect(thinkingHintFromSessionUpdate({
            sessionUpdate: 'state_update',
            state: 'running',
        })).toBe(true)
        expect(thinkingHintFromSessionUpdate({
            sessionUpdate: 'state_update',
            state: 'requires_action',
        })).toBe(true)
        expect(shouldBumpThinkingFromSessionUpdate({
            sessionUpdate: 'state_update',
            state: 'running',
        })).toBe(true)
    })

    it('returns false for state_update idle so mid-idle wakes can clear', () => {
        expect(thinkingHintFromSessionUpdate({
            sessionUpdate: 'state_update',
            state: 'idle',
        })).toBe(false)
        expect(shouldBumpThinkingFromSessionUpdate({
            sessionUpdate: 'state_update',
            state: 'idle',
        })).toBe(false)
    })

    it.each([
        ACP_SESSION_UPDATE_TYPES.usageUpdate,
        ACP_SESSION_UPDATE_TYPES.sessionInfoUpdate,
        'available_commands_update',
        'current_mode_update',
        'config_option_update',
    ] as const)('returns null for noise type %s', (sessionUpdate) => {
        expect(thinkingHintFromSessionUpdate({ sessionUpdate })).toBeNull()
        expect(shouldBumpThinkingFromSessionUpdate({ sessionUpdate })).toBe(false)
    })

    it('returns null for missing or non-string sessionUpdate', () => {
        expect(thinkingHintFromSessionUpdate(null)).toBeNull()
        expect(thinkingHintFromSessionUpdate(undefined)).toBeNull()
        expect(thinkingHintFromSessionUpdate({})).toBeNull()
        expect(thinkingHintFromSessionUpdate({ sessionUpdate: 12 })).toBeNull()
    })
})
