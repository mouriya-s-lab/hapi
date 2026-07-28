import { join } from 'node:path'
import type { Hono } from 'hono'
import type { WebAppEnv } from '../../hub/src/web/middleware/auth'
import { MultiUserGatewayStore } from './gatewayStore'
import { createMultiUserGatewayRoutes } from './gatewayRoutes'
import { hashApiToken } from './token'

export function mountMultiUserGateway(app: Hono<WebAppEnv>, deps: {
    store: MultiUserGatewayStore
    jwtSecret: Uint8Array
    coreUserId: number
}): void {
    app.route('/api', createMultiUserGatewayRoutes({ store: deps.store, jwtSecret: deps.jwtSecret, coreUserId: deps.coreUserId }) as never)
}

export function createMultiUserGatewayStore(dataDir: string, legacyAccessToken: string): MultiUserGatewayStore {
    const store = new MultiUserGatewayStore(join(dataDir, 'multi-user-gateway.sqlite'))
    if (store.countAccounts() === 0) {
        const admin = store.createAccount('admin', 'admin', 'default')
        store.createToken(admin.id, 'legacy bootstrap token', hashApiToken(legacyAccessToken))
    }
    return store
}
