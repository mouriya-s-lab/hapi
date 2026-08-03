import { describe, expect, it } from 'vitest'
import { clearBatchImportedCodexSelection, resolveCodexImportRedirectSessionId } from './codexImportMerge'

describe('resolveCodexImportRedirectSessionId', () => {
    it('prefers the canonical session returned by duplicate merge', () => {
        expect(resolveCodexImportRedirectSessionId(
            [{ canonicalSessionId: 'canonical-session' }],
            ['imported-session']
        )).toBe('canonical-session')
    })

    it('falls back to the imported Hapi session when merge omits a canonical id', () => {
        expect(resolveCodexImportRedirectSessionId(
            [{}],
            ['imported-session']
        )).toBe('imported-session')
    })

    it('returns null when neither source provides a session id', () => {
        expect(resolveCodexImportRedirectSessionId([], [])).toBeNull()
    })
})


describe('clearBatchImportedCodexSelection', () => {
    it('clears a selected history included in the completed batch', () => {
        expect(clearBatchImportedCodexSelection('codex-a', ['codex-a', 'codex-b'])).toBeNull()
    })

    it('preserves a selected history outside the completed batch', () => {
        expect(clearBatchImportedCodexSelection('codex-a', ['codex-b'])).toBe('codex-a')
    })
})
