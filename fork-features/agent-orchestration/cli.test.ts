import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { parseAgentCommand } from './cli'

describe('hapi agent CLI parsing', () => {
    test('parses start, prompt wait, and complete pagination cursors', () => {
        expect(parseAgentCommand(['start', '.', '--kind', 'codex', '--model', 'gpt-5', '--timeout', '60000'])).toEqual({
            verb: 'start',
            directory: resolve('.'),
            kind: 'codex',
            model: 'gpt-5',
            timeoutMs: 60_000
        })
        expect(parseAgentCommand(['prompt', 'full-session-id', 'hello', '--until', 'blocked', '--timeout', '90000'])).toEqual({
            verb: 'prompt',
            sessionId: 'full-session-id',
            text: 'hello',
            wait: true,
            until: 'blocked',
            timeoutMs: 90_000
        })
        expect(parseAgentCommand(['read', 'full-session-id', '--limit', '25', '--before-seq', '8', '--before-at', '0', '--raw'])).toEqual({
            verb: 'read',
            sessionId: 'full-session-id',
            limit: 25,
            before: { seq: 8, at: 0 },
            raw: true
        })
    })

    test('rejects incomplete cursors, mixed directions, and invalid statuses', () => {
        expect(() => parseAgentCommand(['read', 'id', '--before-seq', '8'])).toThrow(
            '--before-seq and --before-at must be provided together'
        )
        expect(() => parseAgentCommand([
            'read', 'id', '--before-seq', '8', '--before-at', '10', '--after-seq', '9', '--after-at', '11'
        ])).toThrow('before and after cursors are mutually exclusive')
        expect(() => parseAgentCommand(['wait', 'id', '--until', 'paused'])).toThrow("invalid status 'paused'")
    })

    test('requires a full start shape and positive bounded values', () => {
        expect(() => parseAgentCommand(['start', '.'])).toThrow('requires --kind')
        expect(() => parseAgentCommand(['wait', 'id', '--timeout', '0'])).toThrow('greater than or equal to 1')
        expect(() => parseAgentCommand(['read', 'id', '--limit', '201'])).toThrow('--limit must be at most 200')
    })
})
