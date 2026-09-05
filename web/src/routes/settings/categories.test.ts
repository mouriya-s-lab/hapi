import { describe, expect, it } from 'vitest'
import { getSettingsCategory } from './categories'

describe('getSettingsCategory', () => {
    it('gives account and user CRUD their own settings categories', () => {
        expect(getSettingsCategory('/settings/account')?.id).toBe('account')
        expect(getSettingsCategory('/settings/users')?.id).toBe('users')
        expect(getSettingsCategory('/settings/users/42')?.id).toBe('users')
    })

    it('matches the fork settings root and descendants without swallowing adjacent prefixes', () => {
        expect(getSettingsCategory('/settings/fork')?.id).toBe('fork')
        expect(getSettingsCategory('/settings/fork/grants')?.id).toBe('fork')
        expect(getSettingsCategory('/settings/forked')?.id).not.toBe('fork')
        expect(getSettingsCategory('/settings/account')?.id).not.toBe('fork')
        expect(getSettingsCategory('/settings/users')?.id).not.toBe('fork')
    })
})
