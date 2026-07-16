import { useEffect, useRef } from 'react'
import { getDraft, saveDraft, clearDraft } from '@/lib/composer-drafts'
import { consumeForkedFromText } from '@/lib/fork-restore'

/**
 * Manages draft save/restore lifecycle for a composer.
 *
 * - On mount: consume any one-shot fork-restore text stashed by #62 c5;
 *   if none, restore saved draft via `setText`. Deferred by one animation
 *   frame so both branches see the runtime's committed initial text.
 * - On unmount: saves current text as draft
 * - The `draftReady` guard prevents saving before the initial restore completes,
 *   avoiding the case where the runtime's empty initial text overwrites a real draft.
 *
 * Fork-restore takes precedence over draft because a fork always starts a
 * brand-new session id — any draft under that id would be either empty or
 * stale-from-a-prior-fork of the same shape, and either way "the message
 * the user just clicked rewind on" is the intended prefill.
 */
export function useComposerDraft(
    sessionId: string | undefined,
    composerText: string,
    setText: (text: string) => void,
): void {
    const composerTextRef = useRef(composerText)
    composerTextRef.current = composerText

    const draftReadyRef = useRef(false)

    useEffect(() => {
        if (!sessionId) return

        const frame = requestAnimationFrame(() => {
            const forkedFrom = consumeForkedFromText(sessionId)
            if (forkedFrom && !composerTextRef.current) {
                clearDraft(sessionId)
                setText(forkedFrom)
                draftReadyRef.current = true
                return
            }
            const draft = getDraft(sessionId)
            if (draft && !composerTextRef.current) {
                setText(draft)
            }
            draftReadyRef.current = true
        })

        return () => {
            cancelAnimationFrame(frame)
            if (draftReadyRef.current) {
                saveDraft(sessionId, composerTextRef.current)
            }
            draftReadyRef.current = false
        }
    }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps
}
