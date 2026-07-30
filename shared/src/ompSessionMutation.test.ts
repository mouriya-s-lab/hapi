import { describe, expect, it } from 'bun:test'
import { parseOmpSessionMutation } from './ompSessionMutation'

describe('parseOmpSessionMutation', () => {
    it('parses valid native lifecycle commands', () => {
        expect(parseOmpSessionMutation('/clear')).toEqual({ type: 'new_session' })
        expect(parseOmpSessionMutation('/rename Native title')).toEqual({
            type: 'set_session_name',
            name: 'Native title'
        })
        expect(parseOmpSessionMutation('/handoff focus')).toEqual({
            type: 'handoff',
            customInstructions: 'focus'
        })
        expect(parseOmpSessionMutation('/resume native-prefix')).toEqual({
            type: 'resume_session',
            sessionArg: 'native-prefix'
        })
    })

    it('distinguishes remote-only usage feedback from ordinary prompts', () => {
        expect(parseOmpSessionMutation('/rename')).toEqual({
            type: 'invalid_session_command',
            message: 'Usage: /rename <title>'
        })
        expect(parseOmpSessionMutation('/resume')).toEqual({ type: 'resume_session_picker' })
        expect(parseOmpSessionMutation('/clear\nnext prompt')).toBeNull()
    })
})
