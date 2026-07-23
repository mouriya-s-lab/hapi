import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiSessionClient } from '@/api/apiSession'

const harness = vi.hoisted(() => ({
    startOptions: null as unknown,
    cliArgs: [] as string[]
}))

vi.mock('@/claude/utils/startHappyServer', () => ({
    startHappyServer: vi.fn(async (_client: unknown, options: { skillLookup?: unknown }) => {
        harness.startOptions = options
        const toolNames = ['change_title', 'display_image', 'display_video', 'send_file']
        if (options.skillLookup) toolNames.push('skill_lookup')
        return { url: 'http://127.0.0.1:43006/', toolNames, stop: vi.fn() }
    })
}))

vi.mock('@/utils/spawnHappyCLI', () => ({
    getHappyCliCommand: vi.fn((args: string[]) => {
        harness.cliArgs = args
        return { command: 'hapi', args }
    })
}))

import { buildHapiMcpBridge } from './buildHapiMcpBridge'

describe('buildHapiMcpBridge merged HAPI tools', () => {
    const client = {} as ApiSessionClient

    beforeEach(() => {
        harness.startOptions = null
        harness.cliArgs = []
    })

    it('forwards and auto-approves media, file, and enabled skill tools', async () => {
        const skillLookup = { workingDirectory: '/repo', flavor: 'opencode' }
        const bridge = await buildHapiMcpBridge(client, { skillLookup })

        expect(harness.startOptions).toEqual({ emitTitleSummary: undefined, skillLookup })
        expect(harness.cliArgs).toEqual([
            'mcp', '--url', 'http://127.0.0.1:43006/', '--tools',
            'change_title,display_image,display_video,send_file,skill_lookup'
        ])
        expect(bridge.mcpServers.hapi.tools).toEqual({
            change_title: { approval_mode: 'approve' },
            display_image: { approval_mode: 'approve' },
            display_video: { approval_mode: 'approve' },
            send_file: { approval_mode: 'approve' },
            skill_lookup: { approval_mode: 'approve' }
        })
    })

    it('keeps fork media/file tools for native-skill bridge callers', async () => {
        const bridge = await buildHapiMcpBridge(client)
        expect(harness.cliArgs.at(-1)).toBe('change_title,display_image,display_video,send_file')
        expect(bridge.mcpServers.hapi.tools).toEqual({
            change_title: { approval_mode: 'approve' },
            display_image: { approval_mode: 'approve' },
            display_video: { approval_mode: 'approve' },
            send_file: { approval_mode: 'approve' }
        })
    })
})
