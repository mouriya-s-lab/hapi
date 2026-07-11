import { describe, expect, it } from 'vitest'
import { normalizeClaudeSessionModel } from './model'

describe('normalizeClaudeSessionModel', () => {
    it('returns null when model is missing', () => {
        expect(normalizeClaudeSessionModel()).toBeNull()
    })

    it('returns null for auto-like values', () => {
        expect(normalizeClaudeSessionModel('')).toBeNull()
        expect(normalizeClaudeSessionModel('auto')).toBeNull()
        expect(normalizeClaudeSessionModel('default')).toBeNull()
    })

    it('preserves Claude aliases and full model strings', () => {
        expect(normalizeClaudeSessionModel('fable')).toBe('fable')
        expect(normalizeClaudeSessionModel('sonnet')).toBe('sonnet')
        expect(normalizeClaudeSessionModel('haiku')).toBe('haiku')
        expect(normalizeClaudeSessionModel('opus[1m]')).toBe('opus[1m]')
        expect(normalizeClaudeSessionModel('claude-3-7-sonnet-latest')).toBe('claude-3-7-sonnet-latest')
        expect(normalizeClaudeSessionModel('claude-fable-5')).toBe('claude-fable-5')
        expect(normalizeClaudeSessionModel('  claude-opus-4-1-20250805  ')).toBe('claude-opus-4-1-20250805')
    })
})
