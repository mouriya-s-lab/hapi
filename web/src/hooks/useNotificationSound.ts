import { useCallback, useEffect, useState } from 'react'

// Per-browser preference: play a chime when a notification toast arrives
// (agent ready for input, permission request, task finished). On by default.
// Follows the localStorage + cross-tab-sync shape of useHideArchivedSessions.

const STORAGE_KEY = 'hapi-notification-sound'
export const DEFAULT_NOTIFICATION_SOUND_ENABLED = true

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

export function parseNotificationSoundEnabled(raw: string | null): boolean {
    if (raw === 'true') return true
    if (raw === 'false') return false
    return DEFAULT_NOTIFICATION_SOUND_ENABLED
}

export function getInitialNotificationSoundEnabled(): boolean {
    return parseNotificationSoundEnabled(safeGetItem(STORAGE_KEY))
}

export function useNotificationSound(): {
    notificationSoundEnabled: boolean
    setNotificationSoundEnabled: (enabled: boolean) => void
} {
    const [notificationSoundEnabled, setNotificationSoundEnabledState] = useState<boolean>(
        () => getInitialNotificationSoundEnabled()
    )

    useEffect(() => {
        if (!isBrowser()) return

        const onStorage = (event: StorageEvent) => {
            if (event.key !== STORAGE_KEY) return
            setNotificationSoundEnabledState(parseNotificationSoundEnabled(event.newValue))
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setNotificationSoundEnabled = useCallback((enabled: boolean) => {
        setNotificationSoundEnabledState(enabled)
        if (enabled === DEFAULT_NOTIFICATION_SOUND_ENABLED) {
            safeRemoveItem(STORAGE_KEY)
        } else {
            safeSetItem(STORAGE_KEY, String(enabled))
        }
    }, [])

    return { notificationSoundEnabled, setNotificationSoundEnabled }
}
