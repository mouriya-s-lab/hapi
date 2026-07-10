import type { CodexAppServerClient } from '../../../cli/src/codex/codexAppServerClient'
import type { CodexForkClient } from './codexFork'

/**
 * Adapts the cli's CodexAppServerClient to the CodexForkClient shape expected
 * by codexForkProvider. Keeps codexFork.ts free of cli-internal imports so that
 * the provider stays testable with a plain stub.
 */
export function createCodexForkClient(appServerClient: CodexAppServerClient): CodexForkClient {
    return {
        async forkThread(args) {
            if (args.tailOffset === undefined) {
                const response = await appServerClient.forkThread({ threadId: args.threadId })
                const newThreadId = response.thread?.id
                if (typeof newThreadId !== 'string' || newThreadId.length === 0) {
                    throw new Error('codex thread/fork: response missing thread.id')
                }
                return { newThreadId }
            }

            const source = await appServerClient.readThread({ threadId: args.threadId, includeTurns: true })
            const targetTurnIndex = source.thread.turns.length - args.tailOffset - 1
            if (targetTurnIndex < 0) {
                throw new Error(`codex thread/fork: tailOffset ${args.tailOffset} exceeds source turn history`)
            }
            const lastTurnId = source.thread.turns[targetTurnIndex]?.id
            if (!lastTurnId) {
                throw new Error(`codex thread/fork: source turn ${targetTurnIndex} missing id`)
            }
            const response = await appServerClient.forkThread({ threadId: args.threadId, lastTurnId })
            const newThreadId = response.thread?.id
            if (typeof newThreadId !== 'string' || newThreadId.length === 0) {
                throw new Error('codex thread/fork: response missing thread.id')
            }
            await appServerClient.rollbackThread({ threadId: newThreadId, numTurns: 1 })
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
