/**
 * One-shot sessionStorage handoff for fork composer restore (#62 c5 →
 * #63 c6). Each forked session owns one key, so storage remains complete
 * without a global JSON map, eviction cap, or lossy parsing path.
 */

const STORAGE_PREFIX = 'hapi:fork-restore:'

function storageKey(sessionId: string): string {
    return `${STORAGE_PREFIX}${sessionId}`
}

/** Stash the source user-message text for the newly-created session. */
export function setForkedFromText(newSessionId: string, text: string): void {
    sessionStorage.setItem(storageKey(newSessionId), text)
}

/** Pop the forked-from text. Removal makes the handoff one-shot. */
export function consumeForkedFromText(sessionId: string): string | null {
    const key = storageKey(sessionId)
    const value = sessionStorage.getItem(key)
    if (value === null) return null
    sessionStorage.removeItem(key)
    return value
}

/** Test-only cleanup for this module's storage namespace. */
export function __resetForkRestoreCacheForTests(): void {
    const keys = Array.from(
        { length: sessionStorage.length },
        (_, index) => sessionStorage.key(index)
    ).filter((key): key is string => key !== null && key.startsWith(STORAGE_PREFIX))
    for (const key of keys) {
        sessionStorage.removeItem(key)
    }
}
