import { describe, it, expect } from 'bun:test'
import { buildClaudeForkCliArgs } from './claudeForkSpawn'

describe('buildClaudeForkCliArgs', () => {
    it('includes --resume <id>, --fork-session, and stream-json IO flags', () => {
        const args = buildClaudeForkCliArgs({
            sourceSessionId: 'src-uuid',
            cwd: '/tmp/work',
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
        })
        expect(args.indexOf('--model')).toBe(-1)
    })

    it('appends --resume-session-at <uuid> when providerMessageId is set', () => {
        const args = buildClaudeForkCliArgs({
            sourceSessionId: 'src',
            cwd: '/t',
            providerMessageId: '1c2445d0-d4aa-4507-915b-2667fbd32144'
        })
        const idx = args.indexOf('--resume-session-at')
        expect(idx).toBeGreaterThanOrEqual(0)
        expect(args[idx + 1]).toBe('1c2445d0-d4aa-4507-915b-2667fbd32144')
    })

    it('omits --resume-session-at when providerMessageId is absent (HEAD fork)', () => {
        const args = buildClaudeForkCliArgs({
            sourceSessionId: 'src',
            cwd: '/t'
        })
        expect(args.indexOf('--resume-session-at')).toBe(-1)
    })

    it('combines --model + --resume-session-at (order-independent)', () => {
        const args = buildClaudeForkCliArgs({
            sourceSessionId: 'src',
            cwd: '/t',
            model: 'claude-opus-4-8',
            providerMessageId: 'asst-uuid'
        })
        const modelIdx = args.indexOf('--model')
        const resumeAtIdx = args.indexOf('--resume-session-at')
        expect(modelIdx).toBeGreaterThanOrEqual(0)
        expect(resumeAtIdx).toBeGreaterThanOrEqual(0)
        expect(args[modelIdx + 1]).toBe('claude-opus-4-8')
        expect(args[resumeAtIdx + 1]).toBe('asst-uuid')
    })
})
