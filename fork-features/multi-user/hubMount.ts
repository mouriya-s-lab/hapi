import { join } from 'node:path'

import type { Hono } from 'hono'

import { getConfiguration } from '../../hub/src/configuration'
import { Store } from '../../hub/src/store'
import type { WebAppEnv } from '../../hub/src/web/middleware/auth'
import { validateTelegramInitData } from '../../hub/src/web/telegramInitData'
import {
    createMultiUserGatewayRoutes,
    type TelegramGatewayAdapter,
    type TelegramGatewayIdentity,
    type TelegramGatewayResult
} from './gatewayRoutes'
import { MultiUserGatewayStore } from './gatewayStore'
import {
    assertNoLegacyForkArtifactsRemaining,
    migrateLegacyForkArtifacts
} from './legacyDbCompat'
import { createPushOwnershipMiddleware } from './pushOwnership'
import { hashApiToken } from './token'

function validateTelegramIdentity(initData: string, botToken: string | null): TelegramGatewayResult | {
    kind: 'validated'
    identity: Omit<TelegramGatewayIdentity, 'namespace'>
} {
    if (!botToken) {
        return {
            kind: 'rejected',
            status: 503,
            error: 'Telegram authentication is disabled. Configure TELEGRAM_BOT_TOKEN.'
        }
    }
    const result = validateTelegramInitData(initData, botToken)
    if (!result.ok) return { kind: 'rejected', status: 401, error: result.error }
    return {
        kind: 'validated',
        identity: {
            platformUserId: String(result.user.id),
            username: result.user.username,
            firstName: result.user.first_name,
            lastName: result.user.last_name
        }
    }
}

export function createTelegramGatewayAdapter(
    coreStore: Store,
    botToken: string | null
): TelegramGatewayAdapter {
    return {
        async authenticate(initData) {
            const result = validateTelegramIdentity(initData, botToken)
            if (result.kind !== 'validated') return result
            const user = coreStore.users.getUser('telegram', result.identity.platformUserId)
            return user
                ? { kind: 'authenticated', identity: { ...result.identity, namespace: user.namespace } }
                : { kind: 'rejected', status: 401, error: 'not_bound' }
        },
        async bind(initData, namespace) {
            const result = validateTelegramIdentity(initData, botToken)
            if (result.kind !== 'validated') return result
            const existing = coreStore.users.getUser('telegram', result.identity.platformUserId)
            if (existing && existing.namespace !== namespace) {
                return { kind: 'rejected', status: 409, error: 'already_bound' }
            }
            if (!existing) coreStore.users.addUser('telegram', result.identity.platformUserId, namespace)
            return { kind: 'authenticated', identity: { ...result.identity, namespace } }
        }
    }
}

export function mountMultiUserGateway(app: Hono<WebAppEnv>, deps: {
    store: MultiUserGatewayStore
    coreStore: Store
    jwtSecret: Uint8Array
    coreUserId: number
}): void {
    const configuration = getConfiguration()
    app.route('/api', createMultiUserGatewayRoutes({
        store: deps.store,
        jwtSecret: deps.jwtSecret,
        coreUserId: deps.coreUserId,
        telegram: createTelegramGatewayAdapter(
            deps.coreStore,
            configuration.telegramEnabled ? configuration.telegramBotToken : null
        )
    }) as never)
}

export function mountMultiUserPostAuth(app: Hono<WebAppEnv>, deps: {
    store: MultiUserGatewayStore
    jwtSecret: Uint8Array
}): void {
    app.use('/api/push/subscribe', createPushOwnershipMiddleware(deps))
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
    if (legacyMigration.kind === 'rejected') {
        throw new Error(
            `PR #102 database compatibility check failed for schema v${legacyMigration.sourceVersion}: `
            + legacyMigration.conflicts.join('; ')
            + '. No legacy source tables or columns were removed.'
        )
    }
    if (legacyMigration.kind === 'migrated') {
        console.log(
            `[Hub] Migrated PR #102 schema v${legacyMigration.sourceVersion} multi-user behavior: `
            + `accounts=${legacyMigration.accountsCopied}, tokens=${legacyMigration.tokensCopied}, `
            + `resources=${legacyMigration.resourcesCopied}, grants=${legacyMigration.grantsCopied}, `
            + `identities=${legacyMigration.externalIdentitiesCopied}, `
            + `push-bindings=${legacyMigration.pushSubscriptionAccountsCopied}, `
            + `orphan-grants-skipped=${legacyMigration.orphanGrantsSkipped.length}, `
            + `core-schema=v${legacyMigration.normalizedCoreVersion}`
        )
        for (const orphan of legacyMigration.orphanGrantsSkipped) {
            console.warn(
                `[Hub] Skipped legacy grant with no surviving resource: `
                + `${orphan.resourceType}#${orphan.resourceId} ${orphan.role} -> account#${orphan.granteeAccountId} `
                + '(the granted session/machine was deleted; re-issue the grant if it still matters)'
            )
        }
    }

    const store = new Store(config.dbPath)
    const multiUserGatewayStore = createMultiUserGatewayStore(config.dataDir, config.cliApiToken)
    assertNoLegacyForkArtifactsRemaining(config.dbPath)

    return { store, multiUserGatewayStore }
}
