import { describe, expect, it } from 'vitest'
import { parseClaudeResumeArgument } from './claude'

describe('parseClaudeResumeArgument', () => {
    it('preserves bare resume for the Claude session picker', () => {
        expect(parseClaudeResumeArgument(['--resume'], 0)).toEqual({
            forwarded: ['--resume'], nextIndex: 0
        })
        expect(parseClaudeResumeArgument(['--resume', '--model', 'sonnet'], 0)).toEqual({
            forwarded: ['--resume'], nextIndex: 0
        })
    })

    it('captures an explicit resume session ID', () => {
        expect(parseClaudeResumeArgument(['--resume', 'session-id'], 0)).toEqual({
            resumeSessionId: 'session-id', forwarded: ['--resume', 'session-id'], nextIndex: 1
        })
    })
})
