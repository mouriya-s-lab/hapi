import type { ForkProvider } from '../providerRegistry'
import type { ForkSpawnPayload, ForkSpawnResult } from '../rpcPayloads'

export interface CodexForkClient {
    /**
     * Fork a codex thread. `numTurns` — when provided — asks the app-server
     * to fork before the last N turns instead of at head; this is Codex's
     * native per-message rewind (#57 c2 / #58). Absent = HEAD fork,
     * behaviorally identical to #55.
     */
    forkThread(args: { threadId: string; numTurns?: number }): Promise<{ newThreadId: string }>
    resumeThread(args: { threadId: string }): Promise<unknown>
    /**
     * Optional teardown. Production wiring uses a short-lived app-server
     * connection per fork (mirrors cli/src/modules/common/codexModels.ts:83-108);
     * close() lets the provider release it deterministically. Stub clients in
     * tests can omit this — it's invoked best-effort.
     */
    close?(): Promise<void> | void
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
            try {
                const { newThreadId } = await client.forkThread({
                    threadId: src,
                    numTurns: payload.forkPoint?.tailOffset
                })
                await client.resumeThread({ threadId: newThreadId })
                return {
                    providerSessionId: newThreadId,
                    metadataPatch: { codexSessionId: newThreadId }
                }
            } finally {
                if (client.close) {
                    await Promise.resolve(client.close()).catch(() => undefined)
                }
            }
        }
    }
}
