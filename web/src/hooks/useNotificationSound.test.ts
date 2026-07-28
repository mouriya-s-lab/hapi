import { beforeEach, describe, expect, it } from 'vitest'
import {
    DEFAULT_NOTIFICATION_SOUND_ENABLED,
    getInitialNotificationSoundEnabled,
    parseNotificationSoundEnabled,
} from './useNotificationSound'

describe('useNotificationSound helpers', () => {
    beforeEach(() => {
        window.localStorage.clear()
    })

    it('defaults to enabled', () => {
        expect(DEFAULT_NOTIFICATION_SOUND_ENABLED).toBe(true)
        expect(getInitialNotificationSoundEnabled()).toBe(true)
    })

    it('falls back to the default for invalid storage values', () => {
        window.localStorage.setItem('hapi-notification-sound', 'sometimes')
        expect(getInitialNotificationSoundEnabled()).toBe(DEFAULT_NOTIFICATION_SOUND_ENABLED)
    })

    it('reads a stored opt-out', () => {
        window.localStorage.setItem('hapi-notification-sound', 'false')
        expect(getInitialNotificationSoundEnabled()).toBe(false)
    })

    it('parses only literal true/false', () => {
        expect(parseNotificationSoundEnabled('true')).toBe(true)
        expect(parseNotificationSoundEnabled('false')).toBe(false)
        expect(parseNotificationSoundEnabled(null)).toBe(DEFAULT_NOTIFICATION_SOUND_ENABLED)
        expect(parseNotificationSoundEnabled('')).toBe(DEFAULT_NOTIFICATION_SOUND_ENABLED)
    })
})
