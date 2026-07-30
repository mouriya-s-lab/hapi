import type { OmpNativeSession } from '../../../shared/src/types'
import type { OmpRpcClient } from '../../../cli/src/omp/rpc/OmpRpcClient'
import type { OmpRpcSpawnConfig } from '../../../cli/src/omp/rpc/types'
import {
    nativeSessionSnapshotFromState,
    reconcileOmpSessionState,
    runOmpSessionMutation
} from '../../../cli/src/omp/rpc/sessionLifecycle'
import type { ForkProvider } from '../providerRegistry'
import type { ForkSpawnPayload, ForkSpawnResult } from '../rpcPayloads'

export type OmpForkClient = Pick<OmpRpcClient, 'discovery' | 'request' | 'close'>
export type OmpForkClientFactory = (config: OmpRpcSpawnConfig) => Promise<OmpForkClient>

function snapshotMetadata(snapshot: OmpNativeSession): ForkSpawnResult {
    return {
        providerSessionId: snapshot.id,
        metadataPatch: { ompSession: snapshot }
    }
}

function requireSourceSession(payload: ForkSpawnPayload): OmpNativeSession {
    const source = payload.sourceMetadata.ompSession
    if (!source) {
        throw new Error('omp fork: sourceMetadata.ompSession is required')
    }
    return source
}

function nativeBranchTextMatches(nativeText: string, hapiText: string): boolean {
    return nativeText === hapiText || nativeText.endsWith(`\n\n${hapiText}`)
}

export function createOmpForkProvider(factory: OmpForkClientFactory): ForkProvider {
    return {
        async spawnFork(payload: ForkSpawnPayload): Promise<ForkSpawnResult> {
            const source = requireSourceSession(payload)
            const config: OmpRpcSpawnConfig = payload.forkPoint
                ? {
                    cwd: payload.sourceCwd,
                    resumeSessionId: source.id,
                    ...(payload.sourceModel ? { model: payload.sourceModel } : {})
                }
                : {
                    cwd: payload.sourceCwd,
                    forkSessionId: source.id,
                    ...(payload.sourceModel ? { model: payload.sourceModel } : {})
                }
            const client = await factory(config)
            try {
                if (!payload.forkPoint) {
                    let snapshot = nativeSessionSnapshotFromState(client.discovery.state)
                    await reconcileOmpSessionState(client, (next) => {
                        snapshot = next
                    })
                    return snapshotMetadata(snapshot)
                }

                const candidates = await client.request({ type: 'get_branch_messages' })
                const targetText = payload.forkPoint.targetText
                const matchingTextTailOffset = payload.forkPoint.matchingTextTailOffset
                if (targetText === undefined || matchingTextTailOffset === undefined) {
                    throw new Error('omp fork: target text mapping is required for a per-message fork')
                }
                const matches = candidates.messages.filter((candidate) => (
                    nativeBranchTextMatches(candidate.text, targetText)
                ))
                const targetIndex = matches.length - matchingTextTailOffset - 1
                const target = matches[targetIndex]
                if (!target) {
                    throw new Error(
                        `omp fork: native branch history has ${candidates.messages.length} user messages `
                        + `and ${matches.length} matching branch targets; cannot resolve selected HAPI turn`
                    )
                }

                const outcome = await runOmpSessionMutation(
                    client,
                    { type: 'branch', entryId: target.entryId },
                    () => undefined
                )
                if (outcome.status !== 'applied') {
                    throw new Error('omp fork: native branch was cancelled')
                }
                return snapshotMetadata(outcome.snapshot)
            } finally {
                await client.close()
            }
        }
    }
}
