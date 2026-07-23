import { describe, it, expect, beforeEach, vi } from 'vitest'
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

    it('roundtrips through memory when sessionStorage quota is exceeded', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
            })

        expect(() => setForkedFromText('large-session', 'large message')).not.toThrow()
        expect(consumeForkedFromText('large-session')).toBe('large message')
        expect(consumeForkedFromText('large-session')).toBeNull()

        setItem.mockRestore()
    })

    it('consume returns null after namespace reset', () => {
        setForkedFromText('sess-1', 'x')
        __resetForkRestoreCacheForTests()
        expect(consumeForkedFromText('sess-1')).toBeNull()
    })
})
