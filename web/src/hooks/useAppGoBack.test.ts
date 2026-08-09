import { describe, expect, it } from 'vitest'
import { getSessionFilesBackSearch, getSettingsBackTarget } from './useAppGoBack'

describe('getSettingsBackTarget', () => {
    it.each([
        ['/settings', '/sessions'],
        ['/settings/general', '/settings'],
        ['/settings/display', '/settings'],
        ['/settings/voice', '/settings'],
        ['/settings/voice/voices', '/settings/voice'],
        ['/settings/voice/advanced', '/settings/voice'],
        ['/settings/account', '/settings'],
        ['/settings/users', '/settings'],
        ['/settings/users/new', '/settings/users'],
        ['/settings/users/42', '/settings/users'],
        ['/sessions', null],
    ])('maps %s to %s', (pathname, target) => {
        expect(getSettingsBackTarget(pathname)).toBe(target)
    })
})

describe('getSessionFilesBackSearch', () => {
    it('preserves the directory tab and file search query', () => {
        expect(getSessionFilesBackSearch({
            path: 'encoded-path',
            staged: false,
            tab: 'directories',
            query: '感',
        })).toEqual({
            tab: 'directories',
            query: '感',
        })
    })

    it('drops unrelated and invalid search values', () => {
        expect(getSessionFilesBackSearch({
            path: 'encoded-path',
            tab: 'changes',
            query: '',
        })).toEqual({})
        expect(getSessionFilesBackSearch(null)).toEqual({})
    })
})
