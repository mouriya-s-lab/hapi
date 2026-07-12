import { describe, expect, it } from 'bun:test'
import { handleCallback } from './callbacks'
import type { SyncEngine } from '../sync/syncEngine'

describe('Telegram callbacks account isolation', () => {
    it('rejects permission actions when the bound account cannot operate the session', async () => {
        const answers: string[] = []
        let approvals = 0
        const engine = {
            getSessionsByNamespace: () => [{
                id: 'session-123456', namespace: 'default', active: true,
                agentState: { requests: { 'request-abcdef': {} } }
            }],
            approvePermission: async () => { approvals += 1 }
        } as unknown as SyncEngine

        await handleCallback('ap:session-:request-', {
            syncEngine: engine,
            namespace: 'default',
            canOperateSession: () => false,
            answerCallback: async (text) => { if (text) answers.push(text) },
            editMessage: async () => {}
        })

        expect(answers).toEqual(['Session access denied'])
        expect(approvals).toBe(0)
    })
})
