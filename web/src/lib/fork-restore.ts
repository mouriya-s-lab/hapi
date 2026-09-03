/**
 * One-shot sessionStorage handoff for fork composer restore (#62 c5 →
 * #63 c6). Each forked session owns one key. When sessionStorage is full or
 * unavailable, an in-memory entry still carries the text across SPA navigation.
 */

const STORAGE_PREFIX = 'hapi:fork-restore:'
const memoryFallback = new Map<string, string>()

function storageKey(sessionId: string): string {
    return `${STORAGE_PREFIX}${sessionId}`
}

/** Stash the source user-message text for the newly-created session. */
export function setForkedFromText(newSessionId: string, text: string): void {
    const key = storageKey(newSessionId)
    try {
        sessionStorage.setItem(key, text)
        memoryFallback.delete(key)
    } catch {
        memoryFallback.set(key, text)
    }
}

/** Pop the forked-from text. Removal makes the handoff one-shot. */
export function consumeForkedFromText(sessionId: string): string | null {
    const key = storageKey(sessionId)
    const fallback = memoryFallback.get(key)
    if (fallback !== undefined) {
        memoryFallback.delete(key)
        return fallback
    }
    try {
        const value = sessionStorage.getItem(key)
        if (value === null) return null
        sessionStorage.removeItem(key)
        return value
    } catch {
        return null
    }
}

/** Test-only cleanup for this module's storage namespace. */
export function __resetForkRestoreCacheForTests(): void {
    memoryFallback.clear()
    const keys = Array.from(
        { length: sessionStorage.length },
        (_, index) => sessionStorage.key(index)
    ).filter((key): key is string => key !== null && key.startsWith(STORAGE_PREFIX))
    for (const key of keys) {
        sessionStorage.removeItem(key)
    }
}
