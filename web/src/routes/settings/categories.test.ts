import { describe, expect, it } from 'vitest'
import { getSettingsCategory } from './categories'

describe('getSettingsCategory', () => {
    it('keeps HAPI Extensions as an entry page instead of a user CRUD category', () => {
        expect(getSettingsCategory('/settings/fork')?.id).toBe('fork')
        expect(getSettingsCategory('/settings/fork/users')).toBeUndefined()
        expect(getSettingsCategory('/settings/fork/users/42')).toBeUndefined()
        expect(getSettingsCategory('/settings/fork/account')).toBeUndefined()
    })

    it('retains categories that own their actual nested settings pages', () => {
        expect(getSettingsCategory('/settings/voice/advanced')?.id).toBe('voice')
    })
})
