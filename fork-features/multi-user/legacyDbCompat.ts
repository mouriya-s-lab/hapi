import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'

import { applyGatewaySchema } from './gatewayStore'

const LEGACY_TABLE_NAMES = ['accounts', 'api_tokens', 'resource_grants'] as const
type LegacyTableName = typeof LEGACY_TABLE_NAMES[number]
type SupportedLegacyVersion = 10 | 11 | 12 | 13
type ResourceType = 'session' | 'machine'

export type LegacyForkArtifacts = {
    userVersion: number
    tables: LegacyTableName[]
    sessionsHasOwnerColumn: boolean
    machinesHasOwnerColumn: boolean
    usersHasAccountColumn: boolean
    pushSubscriptionsHasAccountColumn: boolean
    accountsHasMemoryColumn: boolean
}

export type LegacyMigrationResult =
    | { kind: 'no-op'; reason: 'db-missing' | 'no-artifacts' }
    | { kind: 'rejected'; sourceVersion: number; conflicts: string[] }
    | {
        kind: 'migrated'
        sourceVersion: SupportedLegacyVersion
        normalizedCoreVersion: 9 | 10 | 11
        accountsCopied: number
        tokensCopied: number
        resourcesCopied: number
        grantsCopied: number
        externalIdentitiesCopied: number
        pushSubscriptionAccountsCopied: number
        /**
         * Grants whose source resource row no longer exists (session/machine
         * deleted after the grant was issued). Real fork-era databases carry
         * these; they cannot satisfy the gateway_grants FK and are skipped
         * instead of rejecting the whole migration. Callers should surface
         * each one so the operator can re-issue the grant if it still matters.
         */
        orphanGrantsSkipped: Array<{ resourceType: string; resourceId: string; granteeAccountId: number; role: string }>
    }

type SqliteMasterRow = { name: string }
type LegacyAccountRow = {
    id: number
    username: string
    password_hash: string | null
    auth_provider: string
    role: string
    default_namespace: string
    created_at: number
    disabled_at: number | null
    memory: string | null
}
type LegacyTokenRow = {
    account_id: number
    name: string | null
    token_hash: string
    namespace: string
    created_at: number
    last_used_at: number | null
    revoked_at: number | null
}
type LegacyGrantRow = {
    resource_type: string
    resource_id: string
    grantee_account_id: number
    role: string
}
type LegacyOwnerRow = {
    resource_type: ResourceType
    resource_id: string
    namespace: string
    owner_account_id: number
}
type LegacyExternalIdentityRow = {
    platform: string
    platform_user_id: string
    account_id: number | null
}
type LegacyPushSubscriptionAccountRow = {
    namespace: string
    endpoint: string
    account_id: number
}
type LegacyData = {
    accounts: LegacyAccountRow[]
    tokens: LegacyTokenRow[]
    resources: LegacyOwnerRow[]
    grants: LegacyGrantRow[]
    externalIdentities: LegacyExternalIdentityRow[]
    pushSubscriptionAccounts: LegacyPushSubscriptionAccountRow[]
}
type GatewayAccountRow = {
    id: number
    username: string
    password_hash: string | null
    auth_provider: string
    role: string
    default_namespace: string
    disabled_at: number | null
    memory: string | null
}
type GatewayTokenRow = {
    account_id: number
    namespace: string
    revoked_at: number | null
}

function isResolvedAccountId(accountId: number | null | undefined): accountId is number {
    return accountId !== null && accountId !== undefined
}

function readUserVersion(db: Database): number {
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
    return row?.user_version ?? 0
}

function readLegacyTables(db: Database): LegacyTableName[] {
    const placeholders = LEGACY_TABLE_NAMES.map(() => '?').join(', ')
    const rows = db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
    ).all(...LEGACY_TABLE_NAMES) as SqliteMasterRow[]
    const seen = new Set(rows.map(row => row.name))
    return LEGACY_TABLE_NAMES.filter(name => seen.has(name))
}

function columnNames(db: Database, table: string): Set<string> {
    return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(row => row.name))
}

export function detectLegacyForkArtifacts(db: Database): LegacyForkArtifacts {
    const accountColumns = columnNames(db, 'accounts')
    return {
        userVersion: readUserVersion(db),
        tables: readLegacyTables(db),
        sessionsHasOwnerColumn: columnNames(db, 'sessions').has('owner_account_id'),
        machinesHasOwnerColumn: columnNames(db, 'machines').has('owner_account_id'),
        usersHasAccountColumn: columnNames(db, 'users').has('account_id'),
        pushSubscriptionsHasAccountColumn: columnNames(db, 'push_subscriptions').has('account_id'),
        accountsHasMemoryColumn: accountColumns.has('memory')
    }
}

export function hasAnyLegacyForkArtifacts(artifacts: LegacyForkArtifacts): boolean {
    return artifacts.tables.length > 0
        || artifacts.sessionsHasOwnerColumn
        || artifacts.machinesHasOwnerColumn
        || artifacts.usersHasAccountColumn
        || artifacts.pushSubscriptionsHasAccountColumn
}

function isSupportedLegacyVersion(version: number): version is SupportedLegacyVersion {
    return version === 10 || version === 11 || version === 12 || version === 13
}

function readLegacyResources(db: Database, resourceType: ResourceType): LegacyOwnerRow[] {
    const table = resourceType === 'session' ? 'sessions' : 'machines'
    const rows = db.prepare(`
        SELECT id AS resource_id, namespace, owner_account_id
        FROM ${table} WHERE owner_account_id IS NOT NULL
    `).all() as Array<{ resource_id: string; namespace: string | null; owner_account_id: number }>
    return rows.map(row => ({
        resource_type: resourceType,
        resource_id: row.resource_id,
        namespace: row.namespace ?? 'default',
        owner_account_id: row.owner_account_id
    }))
}

function readLegacyData(db: Database, artifacts: LegacyForkArtifacts): LegacyData {
    const accounts = artifacts.tables.includes('accounts')
        ? db.prepare(`
            SELECT id, username, password_hash, auth_provider, role, default_namespace,
                   created_at, disabled_at, ${artifacts.accountsHasMemoryColumn ? 'memory' : 'NULL AS memory'}
            FROM accounts ORDER BY id
        `).all() as LegacyAccountRow[]
        : []
    const tokens = artifacts.tables.includes('api_tokens')
        ? db.prepare(`
            SELECT account_id, name, token_hash, namespace, created_at, last_used_at, revoked_at
            FROM api_tokens ORDER BY id
        `).all() as LegacyTokenRow[]
        : []
    const resources = [
        ...(artifacts.sessionsHasOwnerColumn ? readLegacyResources(db, 'session') : []),
        ...(artifacts.machinesHasOwnerColumn ? readLegacyResources(db, 'machine') : [])
    ]
    const grants = artifacts.tables.includes('resource_grants')
        ? db.prepare(`
            SELECT resource_type, resource_id, grantee_account_id, role
            FROM resource_grants ORDER BY id
        `).all() as LegacyGrantRow[]
        : []
    const externalIdentities = artifacts.usersHasAccountColumn
        ? db.prepare(`
            SELECT platform, platform_user_id, account_id
            FROM users ORDER BY id
        `).all() as LegacyExternalIdentityRow[]
        : []
    const pushSubscriptionAccounts = artifacts.pushSubscriptionsHasAccountColumn
        ? db.prepare(`
            SELECT namespace, endpoint, account_id
            FROM push_subscriptions WHERE account_id IS NOT NULL ORDER BY id
        `).all() as LegacyPushSubscriptionAccountRow[]
        : []
    return { accounts, tokens, resources, grants, externalIdentities, pushSubscriptionAccounts }
}

function accountBehaviorMatches(source: LegacyAccountRow, target: GatewayAccountRow): boolean {
    return source.password_hash === target.password_hash
        && source.auth_provider === target.auth_provider
        && source.role === target.role
        && source.default_namespace === target.default_namespace
        && source.disabled_at === target.disabled_at
        && source.memory === target.memory
}

function isPristineBootstrapGateway(db: Database, account: GatewayAccountRow): boolean {
    const counts = db.prepare(`
        SELECT
            (SELECT COUNT(*) FROM gateway_accounts) AS accounts,
            (SELECT COUNT(*) FROM gateway_resources) AS resources,
            (SELECT COUNT(*) FROM gateway_grants) AS grants,
            (SELECT COUNT(*) FROM gateway_external_identities) AS identities,
            (SELECT COUNT(*) FROM gateway_push_subscription_accounts) AS push_bindings,
            (SELECT COUNT(*) FROM gateway_api_tokens WHERE name != 'legacy bootstrap token') AS non_bootstrap_tokens
    `).get() as {
        accounts: number
        resources: number
        grants: number
        identities: number
        push_bindings: number
        non_bootstrap_tokens: number
    }
    return counts.accounts === 1
        && counts.resources === 0
        && counts.grants === 0
        && counts.identities === 0
        && counts.push_bindings === 0
        && counts.non_bootstrap_tokens === 0
        && account.username === 'admin'
        && account.password_hash === null
        && account.auth_provider === 'local'
        && account.role === 'admin'
        && account.default_namespace === 'default'
        && account.disabled_at === null
        && account.memory === null
}

function prepareLegacyMigration(gatewayDb: Database, data: LegacyData): {
    accountIds: Map<number, number | null>
    bootstrapAdminSourceId: number | null
    conflicts: string[]
} {
    const conflicts: string[] = []
    const sourceAccountIds = new Set(data.accounts.map(account => account.id))
    const accountIds = new Map<number, number | null>()
    const bootstrapAdminSourceId = data.accounts.find(account => account.role === 'admin')?.id ?? null

    for (const account of data.accounts) {
        if (account.role !== 'admin' && account.role !== 'user') {
            conflicts.push(`accounts#${account.id} has unsupported role=${account.role}`)
            continue
        }
        const target = gatewayDb.prepare(`
            SELECT id, username, password_hash, auth_provider, role, default_namespace, disabled_at, memory
            FROM gateway_accounts WHERE username=?
        `).get(account.username) as GatewayAccountRow | undefined
        if (!target) {
            accountIds.set(account.id, null)
            continue
        }
        if (accountBehaviorMatches(account, target)) {
            accountIds.set(account.id, target.id)
            continue
        }
        if (account.username === 'admin' && isPristineBootstrapGateway(gatewayDb, target)) {
            accountIds.set(account.id, target.id)
            continue
        }
        conflicts.push(`accounts username=${account.username} conflicts with gateway_accounts#${target.id}`)
    }

    function resolveTargetAccountId(sourceId: number | null, location: string): number | null | undefined {
        const effectiveSourceId = sourceId ?? bootstrapAdminSourceId
        if (effectiveSourceId === null) {
            conflicts.push(`${location} has no bootstrap admin account`)
            return undefined
        }
        if (!sourceAccountIds.has(effectiveSourceId)) {
            conflicts.push(`${location} references missing accounts#${effectiveSourceId}`)
            return undefined
        }
        return accountIds.get(effectiveSourceId)
    }

    for (const token of data.tokens) {
        const targetAccountId = resolveTargetAccountId(token.account_id, `api_tokens hash=${token.token_hash}`)
        const target = gatewayDb.prepare(`
            SELECT account_id, namespace, revoked_at FROM gateway_api_tokens WHERE token_hash=?
        `).get(token.token_hash) as GatewayTokenRow | undefined
        if (!target) continue
        if (!isResolvedAccountId(targetAccountId)
            || target.account_id !== targetAccountId
            || target.namespace !== token.namespace
            || target.revoked_at !== token.revoked_at) {
            conflicts.push(`api_tokens hash=${token.token_hash} conflicts with gateway_api_tokens`)
        }
    }

    for (const resource of data.resources) {
        const targetOwnerId = resolveTargetAccountId(
            resource.owner_account_id,
            `${resource.resource_type}#${resource.resource_id}.owner_account_id`
        )
        const target = gatewayDb.prepare(`
            SELECT owner_account_id, core_namespace FROM gateway_resources
            WHERE resource_type=? AND resource_id=?
        `).get(resource.resource_type, resource.resource_id) as { owner_account_id: number; core_namespace: string } | undefined
        if (!target) continue
        if (!isResolvedAccountId(targetOwnerId)
            || target.owner_account_id !== targetOwnerId
            || target.core_namespace !== resource.namespace) {
            conflicts.push(`${resource.resource_type}#${resource.resource_id} conflicts with gateway_resources`)
        }
    }

    for (const grant of data.grants) {
        if (grant.resource_type !== 'session' && grant.resource_type !== 'machine') {
            conflicts.push(`resource_grants resource=${grant.resource_type}:${grant.resource_id} has unsupported type`)
            continue
        }
        if (grant.role !== 'viewer' && grant.role !== 'operator') {
            conflicts.push(`resource_grants resource=${grant.resource_type}:${grant.resource_id} has unsupported role=${grant.role}`)
            continue
        }
        const targetAccountId = resolveTargetAccountId(
            grant.grantee_account_id,
            `resource_grants resource=${grant.resource_type}:${grant.resource_id}`
        )
        const target = gatewayDb.prepare(`
            SELECT role FROM gateway_grants
            WHERE resource_type=? AND resource_id=? AND grantee_account_id=?
        `).get(grant.resource_type, grant.resource_id, targetAccountId ?? -1) as { role: string } | undefined
        if (target && target.role !== grant.role) {
            conflicts.push(`resource_grants resource=${grant.resource_type}:${grant.resource_id} conflicts with gateway_grants`)
        }
    }

    for (const identity of data.externalIdentities) {
        const targetAccountId = resolveTargetAccountId(
            identity.account_id,
            `users identity=${identity.platform}:${identity.platform_user_id}`
        )
        const target = gatewayDb.prepare(`
            SELECT account_id FROM gateway_external_identities WHERE platform=? AND platform_user_id=?
        `).get(identity.platform, identity.platform_user_id) as { account_id: number } | undefined
        if (target && (!isResolvedAccountId(targetAccountId) || target.account_id !== targetAccountId)) {
            conflicts.push(`users identity=${identity.platform}:${identity.platform_user_id} conflicts with gateway_external_identities`)
        }
    }

    for (const binding of data.pushSubscriptionAccounts) {
        const targetAccountId = resolveTargetAccountId(
            binding.account_id,
            `push_subscriptions endpoint=${binding.endpoint}`
        )
        const target = gatewayDb.prepare(`
            SELECT account_id FROM gateway_push_subscription_accounts WHERE namespace=? AND endpoint=?
        `).get(binding.namespace, binding.endpoint) as { account_id: number } | undefined
        if (target && (!isResolvedAccountId(targetAccountId) || target.account_id !== targetAccountId)) {
            conflicts.push(`push_subscriptions endpoint=${binding.endpoint} conflicts with gateway_push_subscription_accounts`)
        }
    }

    return { accountIds, bootstrapAdminSourceId, conflicts }
}

function writeGatewayData(
    db: Database,
    data: LegacyData,
    accountIds: Map<number, number | null>,
    bootstrapAdminSourceId: number | null
): void {
    db.transaction(() => {
        for (const account of data.accounts) {
            const existingId = accountIds.get(account.id)
            if (existingId === undefined) throw new Error(`Missing migration plan for accounts#${account.id}`)
            if (existingId === null) {
                const result = db.prepare(`
                    INSERT INTO gateway_accounts(
                        username,password_hash,auth_provider,role,default_namespace,created_at,disabled_at,memory
                    ) VALUES(?,?,?,?,?,?,?,?)
                `).run(
                    account.username,
                    account.password_hash,
                    account.auth_provider,
                    account.role,
                    account.default_namespace,
                    account.created_at,
                    account.disabled_at,
                    account.memory
                )
                accountIds.set(account.id, Number(result.lastInsertRowid))
                continue
            }
            db.prepare(`
                UPDATE gateway_accounts
                SET password_hash=?, auth_provider=?, role=?, default_namespace=?, created_at=?, disabled_at=?, memory=?
                WHERE id=?
            `).run(
                account.password_hash,
                account.auth_provider,
                account.role,
                account.default_namespace,
                account.created_at,
                account.disabled_at,
                account.memory,
                existingId
            )
        }

        for (const token of data.tokens) {
            const accountId = accountIds.get(token.account_id)
            if (!isResolvedAccountId(accountId)) throw new Error(`Missing account mapping for token ${token.token_hash}`)
            db.prepare(`
                INSERT INTO gateway_api_tokens(
                    account_id,name,token_hash,namespace,created_at,last_used_at,revoked_at
                ) VALUES(?,?,?,?,?,?,?)
                ON CONFLICT(token_hash) DO UPDATE SET
                    name=excluded.name,
                    created_at=excluded.created_at,
                    last_used_at=excluded.last_used_at
            `).run(
                accountId,
                token.name,
                token.token_hash,
                token.namespace,
                token.created_at,
                token.last_used_at,
                token.revoked_at
            )
        }

        for (const resource of data.resources) {
            const ownerAccountId = accountIds.get(resource.owner_account_id)
            if (!isResolvedAccountId(ownerAccountId)) {
                throw new Error(`Missing owner mapping for ${resource.resource_type}#${resource.resource_id}`)
            }
            db.prepare(`
                INSERT INTO gateway_resources(resource_type,resource_id,owner_account_id,core_namespace)
                VALUES(?,?,?,?) ON CONFLICT(resource_type,resource_id) DO NOTHING
            `).run(resource.resource_type, resource.resource_id, ownerAccountId, resource.namespace)
        }

        for (const grant of data.grants) {
            const granteeAccountId = accountIds.get(grant.grantee_account_id)
            if (!isResolvedAccountId(granteeAccountId)) {
                throw new Error(`Missing grantee mapping for ${grant.resource_type}#${grant.resource_id}`)
            }
            db.prepare(`
                INSERT INTO gateway_grants(resource_type,resource_id,grantee_account_id,role)
                VALUES(?,?,?,?) ON CONFLICT(resource_type,resource_id,grantee_account_id) DO NOTHING
            `).run(grant.resource_type, grant.resource_id, granteeAccountId, grant.role)
        }

        for (const identity of data.externalIdentities) {
            const sourceAccountId = identity.account_id ?? bootstrapAdminSourceId
            if (sourceAccountId === null) throw new Error(`Missing bootstrap admin for identity ${identity.platform}:${identity.platform_user_id}`)
            const accountId = accountIds.get(sourceAccountId)
            if (!isResolvedAccountId(accountId)) throw new Error(`Missing account mapping for identity ${identity.platform}:${identity.platform_user_id}`)
            db.prepare(`
                INSERT INTO gateway_external_identities(platform,platform_user_id,account_id)
                VALUES(?,?,?) ON CONFLICT(platform,platform_user_id) DO NOTHING
            `).run(identity.platform, identity.platform_user_id, accountId)
        }

        for (const binding of data.pushSubscriptionAccounts) {
            const accountId = accountIds.get(binding.account_id)
            if (!isResolvedAccountId(accountId)) throw new Error(`Missing account mapping for push endpoint ${binding.endpoint}`)
            db.prepare(`
                INSERT INTO gateway_push_subscription_accounts(namespace,endpoint,account_id)
                VALUES(?,?,?) ON CONFLICT(namespace,endpoint) DO NOTHING
            `).run(binding.namespace, binding.endpoint, accountId)
        }
    })()
}

function normalizeCoreSchema(db: Database, artifacts: LegacyForkArtifacts): 9 | 10 | 11 {
    return db.transaction(() => {
        if (artifacts.sessionsHasOwnerColumn) {
            db.exec('DROP INDEX IF EXISTS idx_sessions_owner')
            db.exec('ALTER TABLE sessions DROP COLUMN owner_account_id')
        }
        if (artifacts.machinesHasOwnerColumn) {
            db.exec('DROP INDEX IF EXISTS idx_machines_owner')
            db.exec('ALTER TABLE machines DROP COLUMN owner_account_id')
        }
        if (artifacts.usersHasAccountColumn) db.exec('ALTER TABLE users DROP COLUMN account_id')
        if (artifacts.pushSubscriptionsHasAccountColumn) db.exec('ALTER TABLE push_subscriptions DROP COLUMN account_id')
        if (artifacts.tables.includes('resource_grants')) db.exec('DROP TABLE resource_grants')
        if (artifacts.tables.includes('api_tokens')) db.exec('DROP TABLE api_tokens')
        if (artifacts.tables.includes('accounts')) db.exec('DROP TABLE accounts')

        const sessions = columnNames(db, 'sessions')
        const hasCurrentSessionColumns = sessions.has('service_tier') && sessions.has('resume_with_session_model')
        const normalizedVersion = hasCurrentSessionColumns
            ? (columnNames(db, 'fcm_devices').size > 0 ? 11 : 10)
            : 9
        db.exec(`PRAGMA user_version = ${normalizedVersion}`)
        return normalizedVersion
    })()
}

/**
 * One-shot migration of the behavior-bearing PR #102 v10-v13 data into the
 * gateway store. Every reference and target collision is checked before the
 * source database is changed. Account associations are retained in typed
 * gateway tables and consumed by fork adapters without restoring multi-user
 * columns to the core store.
 */
export function migrateLegacyForkArtifacts(params: {
    hapiDataPath: string
    gatewayDataPath: string
}): LegacyMigrationResult {
    if (!existsSync(params.hapiDataPath)) return { kind: 'no-op', reason: 'db-missing' }

    const hapiDb = new Database(params.hapiDataPath, { readwrite: true })
    try {
        hapiDb.exec('PRAGMA foreign_keys = OFF')
        const artifacts = detectLegacyForkArtifacts(hapiDb)
        if (!hasAnyLegacyForkArtifacts(artifacts)) return { kind: 'no-op', reason: 'no-artifacts' }
        if (!isSupportedLegacyVersion(artifacts.userVersion)) {
            return {
                kind: 'rejected',
                sourceVersion: artifacts.userVersion,
                conflicts: [`unsupported PR #102 schema version ${artifacts.userVersion}; expected 10, 11, 12, or 13`]
            }
        }
        if (!artifacts.tables.includes('accounts')) {
            return {
                kind: 'rejected',
                sourceVersion: artifacts.userVersion,
                conflicts: ['legacy account references exist but the accounts table is missing']
            }
        }

        const data = readLegacyData(hapiDb, artifacts)

        // Orphan grants: the granted session/machine row was deleted after the
        // grant was issued, so there is no owner binding to migrate and the
        // gateway_grants FK could never hold. Real fork-era databases contain
        // these (grants outlive their sessions); skip them row by row instead
        // of rejecting the whole migration.
        const ownedResourceKeys = new Set(data.resources.map(resource => `${resource.resource_type}:${resource.resource_id}`))
        const orphanGrants = data.grants.filter(grant => !ownedResourceKeys.has(`${grant.resource_type}:${grant.resource_id}`))
        data.grants = data.grants.filter(grant => ownedResourceKeys.has(`${grant.resource_type}:${grant.resource_id}`))

        const gatewayDb = new Database(params.gatewayDataPath, { create: true })
        try {
            applyGatewaySchema(gatewayDb)
            const { accountIds, bootstrapAdminSourceId, conflicts } = prepareLegacyMigration(gatewayDb, data)
            if (conflicts.length > 0) {
                return { kind: 'rejected', sourceVersion: artifacts.userVersion, conflicts }
            }
            writeGatewayData(gatewayDb, data, accountIds, bootstrapAdminSourceId)
        } finally {
            gatewayDb.close()
        }

        const normalizedCoreVersion = normalizeCoreSchema(hapiDb, artifacts)
        return {
            kind: 'migrated',
            sourceVersion: artifacts.userVersion,
            normalizedCoreVersion,
            accountsCopied: data.accounts.length,
            tokensCopied: data.tokens.length,
            resourcesCopied: data.resources.length,
            grantsCopied: data.grants.length,
            externalIdentitiesCopied: data.externalIdentities.length,
            pushSubscriptionAccountsCopied: data.pushSubscriptionAccounts.length,
            orphanGrantsSkipped: orphanGrants.map(grant => ({
                resourceType: grant.resource_type,
                resourceId: grant.resource_id,
                granteeAccountId: grant.grantee_account_id,
                role: grant.role
            }))
        }
    } finally {
        hapiDb.close()
    }
}

export function assertNoLegacyForkArtifactsRemaining(hapiDataPath: string): void {
    if (!existsSync(hapiDataPath)) return
    const db = new Database(hapiDataPath, { readonly: true })
    try {
        const artifacts = detectLegacyForkArtifacts(db)
        if (!hasAnyLegacyForkArtifacts(artifacts)) return
        const parts: string[] = []
        if (artifacts.tables.length > 0) parts.push(`tables=[${artifacts.tables.join(', ')}]`)
        if (artifacts.sessionsHasOwnerColumn) parts.push('sessions.owner_account_id')
        if (artifacts.machinesHasOwnerColumn) parts.push('machines.owner_account_id')
        if (artifacts.usersHasAccountColumn) parts.push('users.account_id')
        if (artifacts.pushSubscriptionsHasAccountColumn) parts.push('push_subscriptions.account_id')
        throw new Error(
            `Legacy fork multi-user artifacts still present in ${hapiDataPath}: ${parts.join('; ')}. `
            + 'Expected them to be migrated into the gateway compatibility model before Store startup.'
        )
    } finally {
        db.close()
    }
}
