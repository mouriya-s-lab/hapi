import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock both storage libs so each test controls exactly what the hook sees
// and we can assert saveDraft/clearDraft interactions independently.
vi.mock('@/lib/composer-drafts', () => ({
    getDraft: vi.fn(() => ''),
    saveDraft: vi.fn(),
    clearDraft: vi.fn(),
}))
vi.mock('@/lib/fork-restore', () => ({
    consumeForkedFromText: vi.fn(() => null as string | null),
}))

import { getDraft, saveDraft, clearDraft } from '@/lib/composer-drafts'
import { consumeForkedFromText } from '@/lib/fork-restore'
import { useComposerDraft } from './useComposerDraft'

const mockGetDraft = vi.mocked(getDraft)
const mockSaveDraft = vi.mocked(saveDraft)
const mockClearDraft = vi.mocked(clearDraft)
const mockConsumeForked = vi.mocked(consumeForkedFromText)

describe('useComposerDraft — fork-restore path (#63 c6)', () => {
    let rAFCallbacks: Array<() => void>

    beforeEach(() => {
        vi.clearAllMocks()
        rAFCallbacks = []
        vi.stubGlobal('requestAnimationFrame', vi.fn((cb: () => void) => {
            rAFCallbacks.push(cb)
            return rAFCallbacks.length
        }))
        vi.stubGlobal('cancelAnimationFrame', vi.fn())
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    function flushRAF() {
        const cbs = [...rAFCallbacks]
        rAFCallbacks = []
        cbs.forEach((cb) => cb())
    }

    it('consumes fork-restore text and prefills composer, skipping draft path', () => {
        mockConsumeForked.mockReturnValue('the source user prompt we rewound to')
        mockGetDraft.mockReturnValue('should-not-be-used')
        const setText = vi.fn()

        renderHook(() => useComposerDraft('sess-new-forked', '', setText))
        act(() => flushRAF())

        expect(mockConsumeForked).toHaveBeenCalledWith('sess-new-forked')
        expect(setText).toHaveBeenCalledWith('the source user prompt we rewound to')
        expect(setText).toHaveBeenCalledTimes(1)
        expect(mockClearDraft).toHaveBeenCalledWith('sess-new-forked')
        expect(mockGetDraft).not.toHaveBeenCalled()
    })

    it('when fork-restore is empty, falls back to draft path (regression)', () => {
        mockConsumeForked.mockReturnValue(null)
        mockGetDraft.mockReturnValue('a preserved draft')
        const setText = vi.fn()

        renderHook(() => useComposerDraft('sess-normal', '', setText))
        act(() => flushRAF())

        expect(mockConsumeForked).toHaveBeenCalledWith('sess-normal')
        expect(mockGetDraft).toHaveBeenCalledWith('sess-normal')
        expect(setText).toHaveBeenCalledWith('a preserved draft')
        expect(mockClearDraft).not.toHaveBeenCalled()
    })

    it('does not overwrite composer that already has text even when fork-restore hits', () => {
        mockConsumeForked.mockReturnValue('the rewound prompt')
        const setText = vi.fn()

        renderHook(() =>
            useComposerDraft('sess-typing', 'user is already typing', setText)
        )
        act(() => flushRAF())

        // We still consume (one-shot semantic: the value is popped from
        // storage), but we don't clobber the user's in-progress text.
        expect(mockConsumeForked).toHaveBeenCalledWith('sess-typing')
        expect(setText).not.toHaveBeenCalled()
        expect(mockClearDraft).not.toHaveBeenCalled()
    })

    it('after fork-restore consumed, unmount saves current text as draft normally', () => {
        mockConsumeForked.mockReturnValue('the rewound prompt')
        const setText = vi.fn()

        const { unmount, rerender } = renderHook(
            ({ text }: { text: string }) => useComposerDraft('sess-x', text, setText),
            { initialProps: { text: '' } }
        )

        // fire rAF → fork-restore consumed, draftReady flipped true
        act(() => flushRAF())

        // Simulate the user editing after the auto-fill
        rerender({ text: 'user edited it after auto-fill' })
        unmount()

        expect(mockSaveDraft).toHaveBeenCalledWith(
            'sess-x',
            'user edited it after auto-fill'
        )
    })

    it('does not touch storage when sessionId is undefined', () => {
        mockConsumeForked.mockReturnValue('should-not-be-consumed')
        const setText = vi.fn()

        const { unmount } = renderHook(() =>
            useComposerDraft(undefined, '', setText)
        )
        act(() => flushRAF())
        unmount()

        expect(mockConsumeForked).not.toHaveBeenCalled()
        expect(mockGetDraft).not.toHaveBeenCalled()
        expect(mockSaveDraft).not.toHaveBeenCalled()
        expect(mockClearDraft).not.toHaveBeenCalled()
    })
})
