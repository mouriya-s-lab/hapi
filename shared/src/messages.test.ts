import { describe, expect, test } from 'bun:test'
import { isClaudeChatVisibleMessage } from './messages'

describe('isClaudeChatVisibleMessage', () => {
    test('keeps model refusal fallback system events visible for the web warning toast', () => {
        expect(isClaudeChatVisibleMessage({
            type: 'system',
            subtype: 'model_refusal_fallback'
        })).toBe(true)
    })
})
