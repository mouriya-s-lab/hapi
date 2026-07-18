import { describe, expect, it } from 'vitest'
import { getSettingsBackTarget } from './useAppGoBack'

describe('getSettingsBackTarget', () => {
    it.each([
        ['/settings', '/sessions'],
        ['/settings/general', '/settings'],
        ['/settings/display', '/settings'],
        ['/settings/voice', '/settings'],
        ['/settings/voice/voices', '/settings/voice'],
        ['/settings/voice/advanced', '/settings/voice'],
        ['/settings/fork/account', '/settings/fork'],
        ['/settings/fork/users', '/settings/fork'],
        ['/settings/fork/users/new', '/settings/fork/users'],
        ['/settings/fork/users/42', '/settings/fork/users'],
        ['/sessions', null],
    ])('maps %s to %s', (pathname, target) => {
        expect(getSettingsBackTarget(pathname)).toBe(target)
    })
})
