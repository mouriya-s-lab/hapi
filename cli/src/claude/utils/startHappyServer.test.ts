import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ApiSessionClient } from '@/api/apiSession'
import { clearGeneratedImages, getGeneratedImage } from '@/modules/common/generatedImages'
import { startHappyServer } from './startHappyServer'

type AgentMediaMessage = {
    type: 'generated-image'
    imageId: string
    fileName: string
    mimeType: string
    id: string
}

describe('startHappyServer inline media MCP', () => {
    const cleanups: Array<() => void | Promise<void>> = []

    afterEach(async () => {
        for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
        clearGeneratedImages()
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
        expect(server.toolNames).toEqual(['change_title', 'display_image', 'display_video'])

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
        expect(getGeneratedImage(messages[0]!.imageId)?.content).toEqual(pngBytes)
        expect(getGeneratedImage(messages[1]!.imageId)?.content).toEqual(mp4Bytes)
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
