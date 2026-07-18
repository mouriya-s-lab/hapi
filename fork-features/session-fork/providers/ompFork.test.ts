import { describe, expect, it, vi } from 'vitest'
import type { OmpCommand, OmpRpcSpawnConfig, OmpSessionState } from '../../../cli/src/omp/rpc/types'
import { createOmpForkProvider } from './ompFork'

function state(id: string): OmpSessionState {
    return {
        isStreaming: false,
        isCompacting: false,
        steeringMode: 'all',
        followUpMode: 'all',
        interruptMode: 'immediate',
        sessionId: id,
        sessionFile: `/sessions/${id}.jsonl`,
        autoCompactionEnabled: true,
        messageCount: 0,
        queuedMessageCount: 0,
        todoPhases: []
    }
}

function payload(forkPoint?: {
    tailOffset: number
    targetText?: string
    matchingTextTailOffset?: number
}) {
    return {
        sourceMetadata: {
            path: '/work',
            host: 'host',
            ompSession: {
                id: 'source-id',
                file: '/sessions/source-id.jsonl',
                name: 'Source'
            }
        },
        sourceCwd: '/work',
        sourceModel: 'openai-codex/gpt-5.6-sol',
        ...(forkPoint ? {
            forkPoint: {
                messageId: 'hapi-message',
                tailOffset: forkPoint.tailOffset,
                isFirstUserTurn: forkPoint.tailOffset === 2,
                targetText: forkPoint.targetText ?? 'two',
                matchingTextTailOffset: forkPoint.matchingTextTailOffset ?? 0
            }
        } : {})
    } as never
}

describe('OMP fork provider', () => {
    it('uses a short-lived --fork RPC for a HEAD fork', async () => {
        const configs: OmpRpcSpawnConfig[] = []
        const close = vi.fn(async () => undefined)
        const provider = createOmpForkProvider(async (config) => {
            configs.push(config)
            return {
                discovery: { version: '17.0.4', state: state('head-fork'), commands: [], models: [] },
                request: vi.fn(async (command: OmpCommand) => {
                    if (command.type === 'get_state') return state('head-fork')
                    throw new Error(`Unexpected command ${command.type}`)
                }) as never,
                close
            }
        })

        await expect(provider.spawnFork(payload())).resolves.toEqual({
            providerSessionId: 'head-fork',
            metadataPatch: {
                ompSession: { id: 'head-fork', file: '/sessions/head-fork.jsonl' }
            }
        })
        expect(configs).toEqual([{
            cwd: '/work',
            forkSessionId: 'source-id',
            model: 'openai-codex/gpt-5.6-sol'
        }])
        expect(close).toHaveBeenCalledOnce()
    })

    it('resolves the native entry from get_branch_messages and branches only the temporary resume RPC', async () => {
        const configs: OmpRpcSpawnConfig[] = []
        const commands: OmpCommand[] = []
        const close = vi.fn(async () => undefined)
        const provider = createOmpForkProvider(async (config) => {
            configs.push(config)
            return {
                discovery: { version: '17.0.4', state: state('source-id'), commands: [], models: [] },
                request: vi.fn(async (command: OmpCommand) => {
                    commands.push(command)
                    if (command.type === 'get_branch_messages') {
                        return {
                            messages: [
                                { entryId: 'native-1', text: 'one' },
                                { entryId: 'native-2', text: 'plan prefix\n\ntwo' },
                                { entryId: 'native-3', text: 'three' }
                            ]
                        }
                    }
                    if (command.type === 'branch') return { text: 'two', cancelled: false }
                    if (command.type === 'get_state') return state('branch-id')
                    throw new Error(`Unexpected command ${command.type}`)
                }) as never,
                close
            }
        })

        const result = await provider.spawnFork(payload({ tailOffset: 1 }))

        expect(configs).toEqual([{
            cwd: '/work',
            resumeSessionId: 'source-id',
            model: 'openai-codex/gpt-5.6-sol'
        }])
        expect(commands).toEqual([
            { type: 'get_branch_messages' },
            { type: 'branch', entryId: 'native-2' },
            { type: 'get_state' }
        ])
        expect(result).toEqual({
            providerSessionId: 'branch-id',
            metadataPatch: {
                ompSession: { id: 'branch-id', file: '/sessions/branch-id.jsonl' }
            }
        })
        expect(close).toHaveBeenCalledOnce()
    })

    it('closes the temporary RPC when native history cannot satisfy the HAPI fork point', async () => {
        const close = vi.fn(async () => undefined)
        const provider = createOmpForkProvider(async () => ({
            discovery: { version: '17.0.4', state: state('source-id'), commands: [], models: [] },
            request: vi.fn(async () => ({ messages: [] })) as never,
            close
        }))

        await expect(provider.spawnFork(payload({ tailOffset: 3 }))).rejects.toThrow(/cannot resolve selected HAPI turn/)
        expect(close).toHaveBeenCalledOnce()
    })

    it('uses matching-text position from the end when prompts are duplicated', async () => {
        const commands: OmpCommand[] = []
        const provider = createOmpForkProvider(async () => ({
            discovery: { version: '17.0.4', state: state('source-id'), commands: [], models: [] },
            request: vi.fn(async (command: OmpCommand) => {
                commands.push(command)
                if (command.type === 'get_branch_messages') {
                    return { messages: [
                        { entryId: 'first-repeat', text: 'repeat' },
                        { entryId: 'between', text: 'different' },
                        { entryId: 'second-repeat', text: 'attachment\n\nrepeat' }
                    ] }
                }
                if (command.type === 'branch') return { text: 'repeat', cancelled: false }
                if (command.type === 'get_state') return state('branch-id')
                throw new Error(`Unexpected command ${command.type}`)
            }) as never,
            close: vi.fn(async () => undefined)
        }))

        await provider.spawnFork(payload({
            tailOffset: 2,
            targetText: 'repeat',
            matchingTextTailOffset: 1
        }))

        expect(commands).toContainEqual({ type: 'branch', entryId: 'first-repeat' })
    })

    it('rejects metadata without the authoritative native snapshot', async () => {
        const factory = vi.fn()
        const provider = createOmpForkProvider(factory)
        await expect(provider.spawnFork({
            sourceMetadata: { path: '/work', host: 'host' },
            sourceCwd: '/work'
        } as never)).rejects.toThrow(/sourceMetadata\.ompSession/)
        expect(factory).not.toHaveBeenCalled()
    })
})
