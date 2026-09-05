import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
    buildHookSettings,
    cleanupHookSettingsFile,
    generateHookSettingsFile
} from './generateHookSettings'

vi.mock('@/utils/spawnHappyCLI', () => ({
    getHappyCliCommand: (args: string[]) => ({
        command: process.execPath,
        args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--', ...args]
    })
}))

const generatedSettingsSchema = z.object({
    hooks: z.object({
        SessionStart: z.array(z.object({
            matcher: z.string(),
            hooks: z.array(z.object({
                type: z.literal('command'),
                command: z.string()
            }))
        }))
    }).passthrough()
}).passthrough()

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

        const generatedPath = generateHookSettingsFile(4312, 'secret token "quoted"', {
            filenamePrefix: 'test-claude-hooks',
            logLabel: 'test',
            hooksEnabled: true,
            trackPermissionMode: true
        })

        try {
            const generated = generatedSettingsSchema.parse(JSON.parse(readFileSync(generatedPath, 'utf8')))

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
            const command = generated.hooks.SessionStart[1].hooks[0].command
            expect(JSON.parse(execSync(command, { encoding: 'utf8' }))).toEqual([
                'hook-forwarder', '--flavor', 'claude', '--port', '4312', '--token', 'secret token "quoted"'
            ])
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
            const generated = generatedSettingsSchema.parse(JSON.parse(readFileSync(generatedPath, 'utf8')))
            expect(generated).toEqual({
                hooks: {
                    SessionStart: [{
                        matcher: '*',
                        hooks: [{ type: 'command', command: expect.any(String) }]
                    }]
                }
            })
            const command = generated.hooks.SessionStart[0].hooks[0].command
            expect(JSON.parse(execSync(command, { encoding: 'utf8' }))).toEqual([
                'hook-forwarder', '--flavor', 'claude', '--port', '4312', '--token', 'secret-token'
            ])
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
