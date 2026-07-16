import { afterEach, describe, expect, it } from 'vitest'
import { MultiUserGatewayStore } from './gatewayStore'
import { ExecutionDispatcher } from './executionDispatcher'

const stores: MultiUserGatewayStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })

describe('ExecutionDispatcher', () => {
    it('routes owner and operator through the resource core namespace without changing core state', () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        const owner = store.createAccount('owner', 'user', 'account-owner')
        const operator = store.createAccount('operator', 'user', 'account-operator')
        store.bindResource({ resourceType: 'machine', resourceId: 'm1', ownerAccountId: owner.id, coreNamespace: 'runtime-a' })
        store.grant('machine', 'm1', operator.id, 'operator')
        const dispatcher = new ExecutionDispatcher(store)

        expect(dispatcher.authorize({ accountId: operator.id, capability: 'operate', resource: { type: 'machine', id: 'm1' } }))
            .toMatchObject({ kind: 'allow', context: { namespace: 'runtime-a' } })
    })

    it('keeps viewer read-only and stranger isolated', () => {
        const store = new MultiUserGatewayStore(':memory:')
        stores.push(store)
        const owner = store.createAccount('owner', 'user', 'owner-ns')
        const viewer = store.createAccount('viewer', 'user', 'viewer-ns')
        const stranger = store.createAccount('stranger', 'user', 'stranger-ns')
        store.bindResource({ resourceType: 'session', resourceId: 's1', ownerAccountId: owner.id, coreNamespace: 'runtime-a' })
        store.grant('session', 's1', viewer.id, 'viewer')
        const dispatcher = new ExecutionDispatcher(store)

        expect(dispatcher.authorize({ accountId: viewer.id, capability: 'read', resource: { type: 'session', id: 's1' } }).kind).toBe('allow')
        expect(dispatcher.authorize({ accountId: viewer.id, capability: 'operate', resource: { type: 'session', id: 's1' } })).toEqual({ kind: 'deny', reason: 'insufficient-access' })
        expect(dispatcher.authorize({ accountId: stranger.id, capability: 'read', resource: { type: 'session', id: 's1' } })).toEqual({ kind: 'deny', reason: 'insufficient-access' })
    })
})
