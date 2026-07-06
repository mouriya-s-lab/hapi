/**
 * One-shot sessionStorage handoff for fork composer restore (#62 c5 →
 * #63 c6). When the user triggers a per-message rewind we stash the source
 * user-message text keyed by the new session id; when the composer for
 * that new session mounts, #63 pops it and pre-fills — the key is deleted
 * after read so the restore only ever fires once.
 *
 * We use sessionStorage (not location state, URL query, or a global store)
 * because:
 *  - the value must survive a client-side route change but not tab reload
 *    (per #57 c6 acceptance: back/forward should not repeatedly restore);
 *  - it must never appear in the URL (#57 c5 acceptance: no URL query
 *    leakage — the forked-from text may be long / sensitive);
 *  - the same pattern is already in use for `composer-drafts` (see
 *    `web/src/lib/composer-drafts.ts`) so ops shape is consistent.
 */

const STORAGE_KEY = 'hapi:fork-restore'
const MAX_ENTRIES = 20

type RestoreMap = Record<string, string>

let cache: RestoreMap | null = null

function safeParseJson(value: string): unknown {
    try {
        return JSON.parse(value) as unknown
    } catch {
        return null
    }
}

function hydrate(): RestoreMap {
    if (cache) return cache
    if (typeof window === 'undefined') {
        cache = {}
        return cache
    }
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY)
        if (!raw) {
            cache = {}
            return cache
        }
        const parsed = safeParseJson(raw)
        if (!parsed || typeof parsed !== 'object') {
            cache = {}
            return cache
        }
        const record = parsed as Record<string, unknown>
        const result: RestoreMap = {}
        for (const [key, value] of Object.entries(record)) {
            if (key.trim().length === 0) continue
            if (typeof value !== 'string') continue
            result[key] = value
        }
        cache = result
        return cache
    } catch {
        cache = {}
        return cache
    }
}

function evict(map: RestoreMap): void {
    const keys = Object.keys(map)
    if (keys.length <= MAX_ENTRIES) return
    const excess = keys.length - MAX_ENTRIES
    for (let i = 0; i < excess; i++) {
        delete map[keys[i]!]
    }
}

function persist(map: RestoreMap): void {
    if (typeof window === 'undefined') return
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    } catch {
        // Ignore storage errors — restore is best-effort UX enhancement.
    }
}

/**
 * Stash forked-from user message text keyed by the newly-created session
 * id. Called by #62 c5 UserMessage rewind handler right before navigation.
 * No-op when text is empty (fork was of an empty prompt — nothing to restore).
 */
export function setForkedFromText(newSessionId: string, text: string): void {
    if (!newSessionId || !text) return
    const map = hydrate()
    delete map[newSessionId]
    map[newSessionId] = text
    evict(map)
    persist(map)
}

/**
 * Pop the forked-from text for a session — returns the text if present and
 * removes the entry so subsequent mounts / back-forward navigations do not
 * see it again. Consumed by #63 c6 composer on session mount.
 */
export function consumeForkedFromText(sessionId: string): string | null {
    if (!sessionId) return null
    const map = hydrate()
    const value = map[sessionId]
    if (value === undefined) return null
    delete map[sessionId]
    persist(map)
    return value
}

/** Test-only: clear the module cache so consecutive tests start clean. */
export function __resetForkRestoreCacheForTests(): void {
    cache = null
    if (typeof window !== 'undefined') {
        try {
            sessionStorage.removeItem(STORAGE_KEY)
        } catch {
            // ignore
        }
    }
}
