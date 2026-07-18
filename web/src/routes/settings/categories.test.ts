import { describe, expect, it } from 'vitest'
import { getSettingsCategory } from './categories'

describe('getSettingsCategory', () => {
    it('gives account and user CRUD their own settings categories', () => {
        expect(getSettingsCategory('/settings/account')?.id).toBe('account')
        expect(getSettingsCategory('/settings/users')?.id).toBe('users')
        expect(getSettingsCategory('/settings/users/42')?.id).toBe('users')
    })

    it('keeps HAPI Extensions limited to its actual entry page', () => {
        expect(getSettingsCategory('/settings/fork')?.id).toBe('fork')
    })
})
