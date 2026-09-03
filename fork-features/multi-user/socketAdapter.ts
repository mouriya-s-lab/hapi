import type { MultiUserGatewayStore } from './gatewayStore'
import { ExecutionDispatcher } from './executionDispatcher'

export function resolveTerminalNamespace(params: {
    store: MultiUserGatewayStore
    accountId: number
    sessionId: string
    getCoreSession: (id: string) => { namespace: string } | null
}): string | null {
    const account = params.store.getAccount(params.accountId)
    const coreSession = params.getCoreSession(params.sessionId)
    if (!account || !coreSession) return null
    if (!params.store.getResource('session', params.sessionId)) {
        if (account.role !== 'admin' && coreSession.namespace !== account.defaultNamespace) return null
        params.store.bindResource({
            resourceType: 'session', resourceId: params.sessionId,
            ownerAccountId: account.id, coreNamespace: coreSession.namespace
        })
    }
    const decision = new ExecutionDispatcher(params.store).authorize({
        accountId: account.id, capability: 'operate', resource: { type: 'session', id: params.sessionId }
    })
    return decision.kind === 'allow' ? decision.context.namespace : null
}
