import { describe, expect, it } from 'vitest'
import { selectIncomingChanges } from './changelog'

const oldCommit = '1'.repeat(40)
const newCommit = '2'.repeat(40)

const payload = {
    version: 'v1',
    commit: newCommit,
    builtAt: '2026-07-11T00:00:00.000Z',
    entries: [
        { hash: newCommit, date: '2026-07-11', subject: 'new behavior' },
        { hash: oldCommit, date: '2026-07-10', subject: 'old behavior' },
    ],
}

describe('selectIncomingChanges', () => {
    it('returns only commits newer than the current build', () => {
        expect(selectIncomingChanges(payload, oldCommit)).toEqual([payload.entries[0]])
    })

    it('returns no entries for a rebuild of the same commit', () => {
        expect(selectIncomingChanges(payload, newCommit)).toEqual([])
    })

    it('rejects malformed changelog input', () => {
        expect(() => selectIncomingChanges({ ...payload, entries: [{ subject: 'missing hash' }] }, oldCommit)).toThrow()
    })

    it('rejects history that cannot prove the current-version boundary', () => {
        expect(() => selectIncomingChanges(payload, '3'.repeat(40))).toThrow(/absent/)
    })
})
