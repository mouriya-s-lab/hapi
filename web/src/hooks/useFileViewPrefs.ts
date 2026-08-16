import { useCallback, useEffect, useState } from 'react'

// Persisted per-browser preferences for the file viewer (issue #3):
//   - markdown preview vs. raw source for .md files
//   - soft word-wrap for the plain-text source view
//
// Both follow the same localStorage + cross-tab-sync shape used by
// useFontScale / useSessionListStatusMode so behaviour is consistent with the
// rest of the app's display settings.

const WORD_WRAP_STORAGE_KEY = 'hapi-file-word-wrap'
const MARKDOWN_PREVIEW_STORAGE_KEY = 'hapi-file-md-preview'

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function safeGetItem(key: string): string | null {
    if (!isBrowser()) return null
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetItem(key: string, value: string): void {
    if (!isBrowser()) return
    try {
        localStorage.setItem(key, value)
    } catch {
        // Ignore storage errors (quota / disabled storage)
    }
}

function parseBoolean(raw: string | null, defaultValue: boolean): boolean {
    if (raw === 'true') return true
    if (raw === 'false') return false
    return defaultValue
}

type PersistedBoolean = readonly [boolean, (next: boolean) => void]

function usePersistedBoolean(storageKey: string, defaultValue: boolean): PersistedBoolean {
    const [value, setValue] = useState<boolean>(() => parseBoolean(safeGetItem(storageKey), defaultValue))

    useEffect(() => {
        if (!isBrowser()) return

        const onStorage = (event: StorageEvent) => {
            if (event.key !== storageKey) return
            setValue(parseBoolean(event.newValue, defaultValue))
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [storageKey, defaultValue])

    const set = useCallback((next: boolean) => {
        setValue(next)
        safeSetItem(storageKey, String(next))
    }, [storageKey])

    return [value, set] as const
}

/** Soft word-wrap toggle for the plain-text source view. Off by default
 * (horizontal scroll), matching the prior behaviour. */
export function useFileWordWrap(): PersistedBoolean {
    return usePersistedBoolean(WORD_WRAP_STORAGE_KEY, false)
}

/** Whether markdown files open in rendered-preview mode. On by default so the
 * new preview is the first thing a user sees for a .md file; toggling off
 * returns to the highlighted raw source. */
export function useFileMarkdownPreview(): PersistedBoolean {
    return usePersistedBoolean(MARKDOWN_PREVIEW_STORAGE_KEY, true)
}
