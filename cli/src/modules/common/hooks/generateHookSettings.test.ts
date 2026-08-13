import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    buildAgyHooksJson,
    buildHookSettings,
    cleanupHookSettingsFile,
    generateHookSettingsFile
} from './generateHookSettings'

describe('buildHookSettings', () => {
    it('registers only SessionStart by default', () => {
        const settings = buildHookSettings({}, 'forward-cmd')
        expect(Object.keys(settings.hooks)).toEqual(['SessionStart'])
        expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('forward-cmd')
    })

    it('adds permission-mode-carrying hooks when trackPermissionMode is set', () => {
        const settings = buildHookSettings({}, 'forward-cmd', undefined, true)
        expect(settings.hooks.UserPromptSubmit?.[0].hooks[0].command).toBe('forward-cmd')
        expect(settings.hooks.PreToolUse?.[0].matcher).toBe('*')
        expect(settings.hooks.PreToolUse?.[0].hooks[0].command).toBe('forward-cmd')
    })
})

describe('generateHookSettingsFile', () => {
    let claudeConfigDir: string
    let originalClaudeConfigDir: string | undefined

    beforeEach(() => {
        claudeConfigDir = mkdtempSync(join(tmpdir(), 'hapi-claude-settings-'))
        originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
        process.env.CLAUDE_CONFIG_DIR = claudeConfigDir
    })

    afterEach(() => {
        if (originalClaudeConfigDir === undefined) {
            delete process.env.CLAUDE_CONFIG_DIR
        } else {
            process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
        }
        rmSync(claudeConfigDir, { recursive: true, force: true })
    })

    it('preserves machine settings and appends the HAPI SessionStart hook', () => {
        const settingsPath = join(claudeConfigDir, 'settings.json')
        const existingHook = {
            matcher: 'startup',
            hooks: [{ type: 'command', command: 'existing-session-hook' }]
        }
        writeFileSync(settingsPath, JSON.stringify({
            model: 'claude-opus-4-6',
            permissions: { allow: ['Read'] },
            hooks: {
                SessionStart: [existingHook],
                Stop: [{ hooks: [{ type: 'command', command: 'existing-stop-hook' }] }]
            },
            hooksConfig: { customValue: true }
        }))

        const generatedPath = generateHookSettingsFile(4312, 'secret-token', {
            filenamePrefix: 'test-claude-hooks',
            logLabel: 'test',
            hooksEnabled: true,
            trackPermissionMode: true
        })

        try {
            const generated = JSON.parse(readFileSync(generatedPath, 'utf8')) as {
                model: string
                permissions: { allow: string[] }
                hooks: Record<string, unknown[]>
                hooksConfig: Record<string, unknown>
            }

            expect(generated.model).toBe('claude-opus-4-6')
            expect(generated.permissions).toEqual({ allow: ['Read'] })
            expect(generated.hooks.Stop).toEqual([
                { hooks: [{ type: 'command', command: 'existing-stop-hook' }] }
            ])
            expect(generated.hooks.SessionStart[0]).toEqual(existingHook)
            expect(generated.hooks.SessionStart[1]).toMatchObject({
                matcher: '*',
                hooks: [{ type: 'command' }]
            })
            expect(generated.hooks.UserPromptSubmit).toHaveLength(1)
            expect(generated.hooks.PreToolUse).toHaveLength(1)
            expect(generated.hooksConfig).toEqual({ customValue: true, enabled: true })
        } finally {
            cleanupHookSettingsFile(generatedPath, 'test')
        }
    })

    it('creates hook-only settings when the machine settings file is absent', () => {
        mkdirSync(claudeConfigDir, { recursive: true })

        const generatedPath = generateHookSettingsFile(4312, 'secret-token', {
            filenamePrefix: 'test-claude-hooks-empty',
            logLabel: 'test'
        })

        try {
            const generated = JSON.parse(readFileSync(generatedPath, 'utf8')) as {
                hooks: { SessionStart: unknown[] }
            }
            expect(generated.hooks.SessionStart).toHaveLength(1)
        } finally {
            cleanupHookSettingsFile(generatedPath, 'test')
        }
    })
})

describe('buildHookSettings PTY approvals', () => {
    it('adds a long-lived PreToolUse hook when includePreToolUse is set', () => {
        const settings = buildHookSettings({}, 'forward-cmd', undefined, false, true)
        expect(settings.hooks.PreToolUse?.[0].matcher).toBe('*')
        expect(settings.hooks.PreToolUse?.[0].hooks[0]).toEqual({
            type: 'command',
            command: 'forward-cmd',
            timeout: 3600
        })
    })
})


describe('buildAgyHooksJson', () => {
    it('produces a valid agy hooks.json with PreToolUse for all tools', () => {
        const parsed = JSON.parse(buildAgyHooksJson({
            preToolUseCommand: 'hapi hook-forwarder --port 12345 --token abc',
            preInvocationCommand: 'hapi hook-forwarder --port 12345 --token abc --event pre-invocation'
        })) as Record<string, { PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string; timeout: number }> }> }>
        const group = Object.values(parsed)[0]
        expect(group.PreToolUse[0].matcher).toBe('*')
        expect(group.PreToolUse[0].hooks[0].command).toContain('hook-forwarder')
        expect(group.PreToolUse[0].hooks[0].timeout).toBeGreaterThanOrEqual(600)
    })

    it('accepts a custom hook name and omits Claude-only type on the PreToolUse entry', () => {
        const parsed = JSON.parse(buildAgyHooksJson({
            preToolUseCommand: 'cmd',
            preInvocationCommand: 'cmd --event pre-invocation',
            hookName: 'my-hook'
        })) as Record<string, { PreToolUse: Array<{ hooks: Array<Record<string, unknown>> }> }>
        expect(parsed['my-hook']).toBeDefined()
        expect('type' in parsed['my-hook'].PreToolUse[0].hooks[0]).toBe(false)
    })

    it('registers PreInvocation as a FLAT array — agy silently ignores the {matcher,hooks} wrapper for this event', () => {
        const parsed = JSON.parse(buildAgyHooksJson({
            preToolUseCommand: 'cmd-pre-tool-use',
            preInvocationCommand: 'cmd-pre-invocation'
        })) as Record<string, {
            PreInvocation: Array<{ type: string; command: string; timeout?: number; matcher?: string; hooks?: unknown }>
        }>
        const group = Object.values(parsed)[0]
        expect(Array.isArray(group.PreInvocation)).toBe(true)
        const entry = group.PreInvocation[0]
        expect(entry).not.toHaveProperty('matcher')
        expect(entry).not.toHaveProperty('hooks')
        expect(entry.type).toBe('command')
        expect(entry.command).toBe('cmd-pre-invocation')
    })

    it('gives PreInvocation a short timeout — it blocks the agent loop synchronously, unlike the long PreToolUse approval wait', () => {
        const parsed = JSON.parse(buildAgyHooksJson({
            preToolUseCommand: 'cmd-pre-tool-use',
            preInvocationCommand: 'cmd-pre-invocation'
        })) as Record<string, {
            PreInvocation: Array<{ timeout?: number }>
            PreToolUse: Array<{ hooks: Array<{ timeout?: number }> }>
        }>
        const group = Object.values(parsed)[0]
        const preInvocationTimeout = group.PreInvocation[0].timeout ?? Infinity
        const preToolUseTimeout = group.PreToolUse[0].hooks[0].timeout ?? Infinity
        expect(preInvocationTimeout).toBeLessThanOrEqual(10)
        expect(preInvocationTimeout).toBeLessThan(preToolUseTimeout)
    })

    it('omits the PreInvocation block entirely when preInvocationCommand is not given (self-detach state)', () => {
        const parsed = JSON.parse(buildAgyHooksJson({
            preToolUseCommand: 'cmd-pre-tool-use'
        })) as Record<string, { PreToolUse: unknown; PreInvocation?: unknown }>
        const group = Object.values(parsed)[0]
        expect(group.PreToolUse).toBeDefined()
        expect('PreInvocation' in group).toBe(false)
    })
})
