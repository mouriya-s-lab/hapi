import { describe, expect, it } from 'vitest'
import { buildShareHiddenByMessageId, shouldHideShareForRunningTurn } from './shareTurnAvailability'

const messages = [
    { id: 'user-old', role: 'user' },
    { id: 'assistant-old', role: 'assistant' },
    { id: 'user-active', role: 'user' },
    { id: 'assistant-active', role: 'assistant' },
]

describe('shouldHideShareForRunningTurn', () => {
    it('builds one lookup containing only the active running turn', () => {
        expect([...buildShareHiddenByMessageId(messages, true)]).toEqual(['user-active', 'assistant-active'])
    })

    it('keeps historical turns shareable while the latest turn is running', () => {
        expect(shouldHideShareForRunningTurn(messages, 'user-old', true)).toBe(false)
        expect(shouldHideShareForRunningTurn(messages, 'assistant-old', true)).toBe(false)
    })

    it('hides both sides of the active turn while it is running', () => {
        expect(shouldHideShareForRunningTurn(messages, 'user-active', true)).toBe(true)
        expect(shouldHideShareForRunningTurn(messages, 'assistant-active', true)).toBe(true)
    })

    it('restores the active turn after generation finishes', () => {
        expect(shouldHideShareForRunningTurn(messages, 'user-active', false)).toBe(false)
        expect(shouldHideShareForRunningTurn(messages, 'assistant-active', false)).toBe(false)
    })

    it('does not let a failed queued attachment redefine the running turn', () => {
        const messagesWithFailedAttachment = [
            ...messages,
            {
                id: 'user-failed',
                role: 'user',
                metadata: { custom: { status: 'failed', invokedAt: null } },
            },
        ]

        expect(shouldHideShareForRunningTurn(messagesWithFailedAttachment, 'user-active', true)).toBe(true)
        expect(shouldHideShareForRunningTurn(messagesWithFailedAttachment, 'assistant-active', true)).toBe(true)
        expect(shouldHideShareForRunningTurn(messagesWithFailedAttachment, 'user-failed', true)).toBe(true)
    })

    it('fails open when the current message is not in the thread snapshot', () => {
        expect(shouldHideShareForRunningTurn(messages, 'missing', true)).toBe(false)
    })

    it('hides every visible assistant message when the active user boundary was trimmed', () => {
        const assistantOnlyMessages = [
            { id: 'assistant-active-1', role: 'assistant' },
            { id: 'assistant-active-2', role: 'assistant' },
        ]

        expect(shouldHideShareForRunningTurn(assistantOnlyMessages, 'assistant-active-1', true)).toBe(true)
        expect(shouldHideShareForRunningTurn(assistantOnlyMessages, 'assistant-active-2', true)).toBe(true)
    })

    it('keeps completed turns shareable before the queued prompt is consumed', () => {
        const runningSince = Date.UTC(2026, 7, 2, 10, 0, 0)
        const completedMessages = [
            { id: 'user-completed', role: 'user', createdAt: new Date(runningSince - 2_000) },
            { id: 'assistant-completed', role: 'assistant', createdAt: new Date(runningSince - 1_000) },
        ]

        expect(shouldHideShareForRunningTurn(completedMessages, 'user-completed', true, runningSince)).toBe(false)
        expect(shouldHideShareForRunningTurn(completedMessages, 'assistant-completed', true, runningSince)).toBe(false)
    })

    it('restores a completed turn when queued grace advances beyond its invocation timestamps', () => {
        const completedAt = Date.UTC(2026, 7, 2, 10, 0, 0)
        const completedTurn = [
            { id: 'user-a', role: 'user', createdAt: new Date(completedAt - 500) },
            { id: 'assistant-a', role: 'assistant', createdAt: new Date(completedAt - 100) },
        ]

        expect(shouldHideShareForRunningTurn(completedTurn, 'user-a', true, completedAt)).toBe(false)
        expect(shouldHideShareForRunningTurn(completedTurn, 'assistant-a', true, completedAt)).toBe(false)
    })

    it('keeps the accepted turn hidden after later keepalives', () => {
        const runningSince = Date.UTC(2026, 7, 2, 10, 0, 0)
        const messagesAfterConsumption = [
            { id: 'user-active', role: 'user', createdAt: new Date(runningSince) },
            { id: 'assistant-partial', role: 'assistant', createdAt: new Date(runningSince + 5_000) },
        ]

        expect(shouldHideShareForRunningTurn(messagesAfterConsumption, 'user-active', true, runningSince)).toBe(true)
        expect(shouldHideShareForRunningTurn(messagesAfterConsumption, 'assistant-partial', true, runningSince)).toBe(true)
    })
})
