import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ApiSessionClient } from '@/api/apiSession'
import { clearGeneratedImages, getGeneratedImage } from '@/modules/common/generatedImages'
import { clearGeneratedFiles, getGeneratedFile } from '@/modules/common/generatedFiles'
import { startHappyServer } from './startHappyServer'

type AgentMediaMessage = {
    type: 'generated-image' | 'generated-file'
    imageId?: string
    fileId?: string
    fileName: string
    mimeType: string
    id: string
}

describe('startHappyServer inline media MCP', () => {
    const cleanups: Array<() => void | Promise<void>> = []

    afterEach(async () => {
        for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
        clearGeneratedImages()
        clearGeneratedFiles()
    })

    it('accepts real MCP display_image and display_video calls and registers their bytes', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-inline-media-mcp-'))
        cleanups.push(() => rm(directory, { recursive: true, force: true }))
        const pngPath = join(directory, 'screen.png')
        const mp4Path = join(directory, 'recording.mp4')
        const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
        const mp4Bytes = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
        await writeFile(pngPath, pngBytes)
        await writeFile(mp4Path, mp4Bytes)

        const messages: AgentMediaMessage[] = []
        let metadata: Record<string, unknown> = {}
        const sessionClient = {
            sendClaudeSessionMessage: () => undefined,
            sendAgentMessage: (message: unknown) => messages.push(message as AgentMediaMessage),
            updateMetadata: (update: (current: Record<string, unknown>) => Record<string, unknown>) => {
                metadata = update(metadata)
            }
        } as unknown as ApiSessionClient

        const server = await startHappyServer(sessionClient)
        cleanups.push(server.stop)
        expect(metadata.hapiMcpUrl).toBe(server.url)
        expect(server.toolNames).toEqual(['change_title', 'display_image', 'display_video', 'send_file'])

        const client = new Client({ name: 'inline-media-integration-test', version: '1.0.0' })
        await client.connect(new StreamableHTTPClientTransport(new URL(server.url)))
        cleanups.push(() => client.close())

        const imageResult = await client.callTool({
            name: 'display_image',
            arguments: { path: pngPath, title: 'Captured screen.png' }
        })
        const videoResult = await client.callTool({
            name: 'display_video',
            arguments: { path: mp4Path, title: 'Recorded flow.mp4' }
        })

        expect(imageResult.isError).toBe(false)
        expect(videoResult.isError).toBe(false)
        expect(messages.map(({ fileName, mimeType }) => ({ fileName, mimeType }))).toEqual([
            { fileName: 'Captured screen.png', mimeType: 'image/png' },
            { fileName: 'Recorded flow.mp4', mimeType: 'video/mp4' }
        ])
        expect(getGeneratedImage(messages[0]!.imageId!)?.content).toEqual(pngBytes)
        expect(getGeneratedImage(messages[1]!.imageId!)?.content).toEqual(mp4Bytes)
    })

    it('accepts a real MCP send_file call, snapshots bytes, and rejects a missing file', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-send-file-mcp-'))
        cleanups.push(() => rm(directory, { recursive: true, force: true }))
        const reportPath = join(directory, 'report.md')
        await writeFile(reportPath, '# report')

        const messages: AgentMediaMessage[] = []
        const sessionClient = {
            sendClaudeSessionMessage: () => undefined,
            sendAgentMessage: (message: unknown) => messages.push(message as AgentMediaMessage),
            updateMetadata: () => undefined
        } as unknown as ApiSessionClient
        const server = await startHappyServer(sessionClient)
        cleanups.push(server.stop)
        const client = new Client({ name: 'send-file-integration-test', version: '1.0.0' })
        await client.connect(new StreamableHTTPClientTransport(new URL(server.url)))
        cleanups.push(() => client.close())

        const sent = await client.callTool({
            name: 'send_file',
            arguments: { path: reportPath, title: 'Final report' }
        })
        const missing = await client.callTool({
            name: 'send_file',
            arguments: { path: join(directory, 'missing.md') }
        })

        expect(sent.isError).toBe(false)
        expect(missing.isError).toBe(true)
        expect(messages).toHaveLength(1)
        expect(messages[0]).toMatchObject({
            type: 'generated-file',
            fileName: 'Final_report.md',
            mimeType: 'text/markdown'
        })
        expect(getGeneratedFile(messages[0]!.fileId!)?.size).toBe(Buffer.byteLength('# report'))
    })

    it('rejects media sent through the wrong tool without emitting a card', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-inline-media-mismatch-'))
        cleanups.push(() => rm(directory, { recursive: true, force: true }))
        const mp4Path = join(directory, 'recording.mp4')
        await writeFile(mp4Path, Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]))

        const messages: AgentMediaMessage[] = []
        const sessionClient = {
            sendClaudeSessionMessage: () => undefined,
            sendAgentMessage: (message: unknown) => messages.push(message as AgentMediaMessage),
            updateMetadata: () => undefined
        } as unknown as ApiSessionClient
        const server = await startHappyServer(sessionClient)
        cleanups.push(server.stop)
        const client = new Client({ name: 'inline-media-mismatch-test', version: '1.0.0' })
        await client.connect(new StreamableHTTPClientTransport(new URL(server.url)))
        cleanups.push(() => client.close())

        const result = await client.callTool({ name: 'display_image', arguments: { path: mp4Path } })

        expect(result.isError).toBe(true)
        expect(messages).toEqual([])
    })
})

type ToolResult = {
    content?: Array<{ type: string; text?: string }>
    isError?: boolean
}

describe('startHappyServer skill_lookup', () => {
    const originalHome = process.env.HOME
    let sandboxDir: string
    let workingDirectory: string
    let client: Client | null
    let stopServer: (() => void) | null

    beforeEach(async () => {
        sandboxDir = await mkdtemp(join(tmpdir(), 'hapi-skill-mcp-'))
        workingDirectory = join(sandboxDir, 'repo')
        process.env.HOME = join(sandboxDir, 'home')
        await mkdir(join(workingDirectory, '.git'), { recursive: true })
        await mkdir(process.env.HOME, { recursive: true })
        client = null
        stopServer = null
    })

    afterEach(async () => {
        await client?.close()
        stopServer?.()
        if (originalHome === undefined) {
            delete process.env.HOME
        } else {
            process.env.HOME = originalHome
        }
        await rm(sandboxDir, { recursive: true, force: true })
    })

    async function connect(enableSkillLookup = true): Promise<Client> {
        const sessionClient = {
            updateMetadata: vi.fn(),
            sendAgentMessage: vi.fn(),
            sendClaudeSessionMessage: vi.fn()
        } as unknown as ApiSessionClient
        const server = await startHappyServer(sessionClient, enableSkillLookup
            ? {
                skillLookup: {
                    workingDirectory,
                    flavor: 'opencode'
                }
            }
            : {})
        stopServer = server.stop

        client = new Client(
            { name: 'hapi-skill-lookup-test', version: '1.0.0' },
            { capabilities: {} }
        )
        await client.connect(new StreamableHTTPClientTransport(new URL(server.url)))
        return client
    }

    it('returns a discovered SKILL.md body', async () => {
        const skillDir = join(workingDirectory, '.agents', 'skills', 'review')
        await mkdir(skillDir, { recursive: true })
        await writeFile(join(skillDir, 'SKILL.md'), [
            '---',
            'name: review',
            'description: Review changes safely',
            '---',
            '',
            '# Review instructions',
            '',
            'Inspect the diff before editing.'
        ].join('\n'))

        const mcp = await connect()
        const result = await mcp.callTool({
            name: 'skill_lookup',
            arguments: { name: 'review' }
        }) as ToolResult

        expect(result.isError).toBe(false)
        expect(result.content?.[0]?.text).toContain('Skill: review')
        expect(result.content?.[0]?.text).toContain('Description: Review changes safely')
        expect(result.content?.[0]?.text).toContain('# Review instructions')
    })

    it('returns a tool error for an unknown skill', async () => {
        const mcp = await connect()
        const result = await mcp.callTool({
            name: 'skill_lookup',
            arguments: { name: 'missing' }
        }) as ToolResult

        expect(result.isError).toBe(true)
        expect(result.content?.[0]?.text).toContain('Skill not found: missing')
    })

    it('does not expose the fallback tool to native-skill sessions', async () => {
        const mcp = await connect(false)
        const tools = await mcp.listTools()

        expect(tools.tools.map((tool) => tool.name)).toEqual([
            'change_title',
            'display_image',
            'display_video',
            'send_file'
        ])
    })
})
