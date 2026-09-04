import { useCallback, useEffect, useState } from 'react'

// Per-browser preference: hide sessions the user explicitly archived from the
// session menu (issue #4). Off by default. Follows the localStorage +
// cross-tab-sync shape of useSessionListStatusMode.

const STORAGE_KEY = 'hapi-hide-archived-sessions'
const DEFAULT_HIDE_ARCHIVED = false

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
        // Ignore storage errors
    }
}

function safeRemoveItem(key: string): void {
    if (!isBrowser()) return
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore storage errors
    }
}

function parseHideArchived(raw: string | null): boolean {
    if (raw === 'true') return true
    if (raw === 'false') return false
    return DEFAULT_HIDE_ARCHIVED
}

export function useHideArchivedSessions(): {
    hideArchivedSessions: boolean
    setHideArchivedSessions: (hide: boolean) => void
} {
    const [hideArchivedSessions, setHideArchivedSessionsState] = useState<boolean>(
        () => parseHideArchived(safeGetItem(STORAGE_KEY))
    )

    useEffect(() => {
        if (!isBrowser()) return

        const onStorage = (event: StorageEvent) => {
            if (event.key !== STORAGE_KEY) return
            setHideArchivedSessionsState(parseHideArchived(event.newValue))
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setHideArchivedSessions = useCallback((hide: boolean) => {
        setHideArchivedSessionsState(hide)
        if (hide === DEFAULT_HIDE_ARCHIVED) {
            safeRemoveItem(STORAGE_KEY)
        } else {
            safeSetItem(STORAGE_KEY, String(hide))
        }
    }, [])

    return { hideArchivedSessions, setHideArchivedSessions }
}
