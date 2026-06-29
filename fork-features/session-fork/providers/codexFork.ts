import type { ForkProvider } from '../providerRegistry'
import type { ForkSpawnPayload, ForkSpawnResult } from '../rpcPayloads'

export interface CodexForkClient {
    forkThread(args: { threadId: string }): Promise<{ newThreadId: string }>
    resumeThread(args: { threadId: string }): Promise<unknown>
}

export type CodexForkClientFactory = () => CodexForkClient | Promise<CodexForkClient>

export function createCodexForkProvider(factory: CodexForkClientFactory): ForkProvider {
    return {
        async spawnFork(payload: ForkSpawnPayload): Promise<ForkSpawnResult> {
            const src = payload.sourceMetadata.codexSessionId
            if (!src) {
                throw new Error('codex fork: sourceMetadata.codexSessionId is required')
            }
            const client = await factory()
            const { newThreadId } = await client.forkThread({ threadId: src })
            await client.resumeThread({ threadId: newThreadId })
            return {
                providerSessionId: newThreadId,
                metadataPatch: { codexSessionId: newThreadId }
            }
        }
    }
}
