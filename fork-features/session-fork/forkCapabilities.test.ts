import { describe, it, expect } from 'bun:test'
import {
    getForkCapability,
    isForkCapableFlavor,
    getAllForkCapabilities
} from './forkCapabilities'

describe('forkCapabilities', () => {
    it('claude reports at-message fork (via --resume-session-at)', () => {
        expect(getForkCapability('claude')).toEqual({ fork: 'at-message', files: 'none' })
    })

    it('codex reports at-message fork (via ThreadForkParams.lastTurnId)', () => {
        expect(getForkCapability('codex')).toEqual({ fork: 'at-message', files: 'none' })
    })

    it('omp reports at-message fork through native branch(entryId)', () => {
        expect(getForkCapability('omp')).toEqual({ fork: 'at-message', files: 'none' })
    })

    it('cursor/gemini/kimi/opencode/pi report no fork', () => {
        for (const flavor of ['cursor', 'gemini', 'kimi', 'opencode', 'pi']) {
            expect(getForkCapability(flavor)).toEqual({ fork: 'none', files: 'none' })
        }
    })

    it('unknown flavor falls back to none', () => {
        expect(getForkCapability('does-not-exist')).toEqual({ fork: 'none', files: 'none' })
    })

    it('files slot is universally none in this umbrella', () => {
        for (const flavor of ['claude', 'codex', 'cursor', 'gemini', 'kimi', 'opencode', 'pi', 'omp']) {
            expect(getForkCapability(flavor).files).toBe('none')
        }
    })

    it('isForkCapableFlavor is true iff fork !== none', () => {
        expect(isForkCapableFlavor('claude')).toBe(true)
        expect(isForkCapableFlavor('codex')).toBe(true)
        expect(isForkCapableFlavor('omp')).toBe(true)
        expect(isForkCapableFlavor('cursor')).toBe(false)
        expect(isForkCapableFlavor('does-not-exist')).toBe(false)
    })

    it('getAllForkCapabilities exposes the full static table', () => {
        const all = getAllForkCapabilities()
        expect(all.claude).toEqual({ fork: 'at-message', files: 'none' })
        expect(all.codex).toEqual({ fork: 'at-message', files: 'none' })
        expect(all.omp).toEqual({ fork: 'at-message', files: 'none' })
        expect(all.cursor).toEqual({ fork: 'none', files: 'none' })
        // Mutating the returned map does not affect subsequent reads.
        all.claude = { fork: 'none', files: 'none' }
        expect(getForkCapability('claude').fork).toBe('at-message')
    })
})
