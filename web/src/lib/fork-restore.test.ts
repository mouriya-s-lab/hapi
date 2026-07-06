import { describe, it, expect, beforeEach } from 'vitest'
import {
    setForkedFromText,
    consumeForkedFromText,
    __resetForkRestoreCacheForTests
} from './fork-restore'

beforeEach(() => {
    __resetForkRestoreCacheForTests()
})

describe('fork-restore', () => {
    it('roundtrips text via setForkedFromText/consumeForkedFromText', () => {
        setForkedFromText('sess-1', 'hello from source')
        expect(consumeForkedFromText('sess-1')).toBe('hello from source')
    })

    it('consumes are one-shot: second consume returns null', () => {
        setForkedFromText('sess-1', 'x')
        expect(consumeForkedFromText('sess-1')).toBe('x')
        expect(consumeForkedFromText('sess-1')).toBeNull()
    })

    it('consume returns null when nothing was set', () => {
        expect(consumeForkedFromText('never-set')).toBeNull()
    })

    it('setForkedFromText no-ops on empty session id or empty text', () => {
        setForkedFromText('', 'x')
        setForkedFromText('sess-empty', '')
        expect(consumeForkedFromText('')).toBeNull()
        expect(consumeForkedFromText('sess-empty')).toBeNull()
    })

    it('overwrites when set twice for the same session', () => {
        setForkedFromText('sess-x', 'first')
        setForkedFromText('sess-x', 'second')
        expect(consumeForkedFromText('sess-x')).toBe('second')
    })

    it('isolates entries per session id', () => {
        setForkedFromText('a', 'text-a')
        setForkedFromText('b', 'text-b')
        expect(consumeForkedFromText('a')).toBe('text-a')
        expect(consumeForkedFromText('b')).toBe('text-b')
    })

    it('consume returns null after cache reset (fresh session)', () => {
        setForkedFromText('sess-1', 'x')
        __resetForkRestoreCacheForTests()
        expect(consumeForkedFromText('sess-1')).toBeNull()
    })
})
