import { describe, expect, it } from 'vitest'
import { normalizeHookPermissionMode } from './hookPermissionMode'

describe('normalizeHookPermissionMode', () => {
    it('passes through HAPI claude modes', () => {
        expect(normalizeHookPermissionMode('default')).toBe('default')
        expect(normalizeHookPermissionMode('acceptEdits')).toBe('acceptEdits')
        expect(normalizeHookPermissionMode('auto')).toBe('auto')
        expect(normalizeHookPermissionMode('bypassPermissions')).toBe('bypassPermissions')
        expect(normalizeHookPermissionMode('plan')).toBe('plan')
    })

    it("maps claude's 'manual' to 'default'", () => {
        expect(normalizeHookPermissionMode('manual')).toBe('default')
    })

    it('rejects modes HAPI has no claude equivalent for', () => {
        expect(normalizeHookPermissionMode('dontAsk')).toBeNull()
        expect(normalizeHookPermissionMode('yolo')).toBeNull()
        expect(normalizeHookPermissionMode('garbage')).toBeNull()
    })

    it('rejects non-string payloads', () => {
        expect(normalizeHookPermissionMode(undefined)).toBeNull()
        expect(normalizeHookPermissionMode(null)).toBeNull()
        expect(normalizeHookPermissionMode(42)).toBeNull()
    })
})
