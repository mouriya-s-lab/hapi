export type ParsedOmpSessionMutation =
    | { type: 'new_session' }
    | { type: 'set_session_name'; name: string }
    | { type: 'handoff'; customInstructions?: string }
    | { type: 'resume_session'; sessionArg: string }
    | { type: 'resume_session_picker' }
    | { type: 'invalid_session_command'; message: string }

export function parseOmpSessionMutation(message: string): ParsedOmpSessionMutation | null {
    const trimmed = message.trim()
    if (trimmed === '/new' || trimmed === '/clear') {
        return { type: 'new_session' }
    }
    const rename = /^\/rename\s+(.+)$/s.exec(trimmed)
    const name = rename?.[1]?.trim()
    if (name) {
        return { type: 'set_session_name', name }
    }
    if (trimmed === '/rename') {
        return { type: 'invalid_session_command', message: 'Usage: /rename <title>' }
    }
    if (trimmed === '/handoff') {
        return { type: 'handoff' }
    }
    const handoff = /^\/handoff\s+(.+)$/s.exec(trimmed)
    const customInstructions = handoff?.[1]?.trim()
    if (customInstructions) {
        return { type: 'handoff', customInstructions }
    }
    if (trimmed === '/resume') {
        return { type: 'resume_session_picker' }
    }
    const resume = /^\/resume\s+(.+)$/s.exec(trimmed)
    const sessionArg = resume?.[1]?.trim()
    return sessionArg ? { type: 'resume_session', sessionArg } : null
}
