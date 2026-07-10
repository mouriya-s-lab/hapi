import type { CodexAppServerClient } from '../../../cli/src/codex/codexAppServerClient'
import type { CodexForkClient } from './codexFork'

/**
 * Adapts the cli's CodexAppServerClient to the CodexForkClient shape expected
 * by codexForkProvider. Keeps codexFork.ts free of cli-internal imports so that
 * the provider stays testable with a plain stub.
 */
export function createCodexForkClient(appServerClient: CodexAppServerClient): CodexForkClient {
    return {
        async forkThread({ threadId, numTurns }) {
            const response = await appServerClient.forkThread({ threadId, numTurns })
            const newThreadId = response.thread?.id
            if (typeof newThreadId !== 'string' || newThreadId.length === 0) {
                throw new Error('codex thread/fork: response missing thread.id')
            }
            return { newThreadId }
        },
        async resumeThread({ threadId }) {
            await appServerClient.resumeThread({ threadId })
        },
        async close() {
            await appServerClient.disconnect().catch(() => undefined)
        }
    }
}
