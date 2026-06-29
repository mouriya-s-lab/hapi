import { describe, it, expect } from 'bun:test'
import { buildClaudeForkCliArgs } from './claudeForkSpawn'

describe('buildClaudeForkCliArgs', () => {
    it('includes --resume <id>, --fork-session, and stream-json IO flags', () => {
        const args = buildClaudeForkCliArgs({
            sourceSessionId: 'src-uuid',
            cwd: '/tmp/work',
            newHapiSessionId: 'new-hapi'
        })
        const resumeIdx = args.indexOf('--resume')
        expect(resumeIdx).toBeGreaterThanOrEqual(0)
        expect(args[resumeIdx + 1]).toBe('src-uuid')
        expect(args).toContain('--fork-session')
        expect(args).toContain('--print')
        const inIdx = args.indexOf('--input-format')
        expect(args[inIdx + 1]).toBe('stream-json')
        const outIdx = args.indexOf('--output-format')
        expect(args[outIdx + 1]).toBe('stream-json')
    })

    it('appends --model when provided', () => {
        const args = buildClaudeForkCliArgs({
            sourceSessionId: 's',
            cwd: '/t',
            newHapiSessionId: 'n',
            model: 'claude-opus-4-8'
        })
        const modelIdx = args.indexOf('--model')
        expect(modelIdx).toBeGreaterThanOrEqual(0)
        expect(args[modelIdx + 1]).toBe('claude-opus-4-8')
    })

    it('omits --model when not provided', () => {
        const args = buildClaudeForkCliArgs({
            sourceSessionId: 's',
            cwd: '/t',
            newHapiSessionId: 'n'
        })
        expect(args.indexOf('--model')).toBe(-1)
    })
})
