import { join } from 'node:path'
import type { Hono } from 'hono'
import type { WebAppEnv } from '../../hub/src/web/middleware/auth'
import { Store } from '../../hub/src/store'
import { MultiUserGatewayStore } from './gatewayStore'
import { createMultiUserGatewayRoutes } from './gatewayRoutes'
import {
    assertNoLegacyForkArtifactsRemaining,
    migrateLegacyForkArtifacts
} from './legacyDbCompat'
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

export type ForkMultiUserBootstrap = {
    store: Store
    multiUserGatewayStore: MultiUserGatewayStore
}

/**
 * Single fork entry point that replaces the two-line pair
 *   const store = new Store(config.dbPath)
 *   const multiUserGatewayStore = createMultiUserGatewayStore(config.dataDir, config.cliApiToken)
 * in startHub. Keeps the PR #102 legacy DB compat migration + post-boot
 * assertion inside fork-features so upstream startHub only sees one call.
 */
export function bootstrapForkMultiUser(config: {
    dbPath: string
    dataDir: string
    cliApiToken: string
}): ForkMultiUserBootstrap {
    const gatewayDataPath = join(config.dataDir, 'multi-user-gateway.sqlite')
    const legacyMigration = migrateLegacyForkArtifacts({
        hapiDataPath: config.dbPath,
        gatewayDataPath
    })
    if (legacyMigration.kind === 'migrated') {
        console.log(
            `[Hub] Migrated PR #102 legacy multi-user artifacts: ` +
            `accounts=${legacyMigration.accountsCopied}, tokens=${legacyMigration.tokensCopied}, ` +
            `resources=${legacyMigration.resourcesCopied}, grants=${legacyMigration.grantsCopied}` +
            (legacyMigration.orphanedOwnerRows > 0 ? `, orphaned-owners=${legacyMigration.orphanedOwnerRows}` : '') +
            (legacyMigration.orphanedGrants > 0 ? `, orphaned-grants=${legacyMigration.orphanedGrants}` : '')
        )
    }

    const store = new Store(config.dbPath)
    const multiUserGatewayStore = createMultiUserGatewayStore(config.dataDir, config.cliApiToken)
    assertNoLegacyForkArtifactsRemaining(config.dbPath)

    return { store, multiUserGatewayStore }
}
