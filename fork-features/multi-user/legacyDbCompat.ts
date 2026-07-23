import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'

import { applyGatewaySchema } from './gatewayStore'

const LEGACY_TABLE_NAMES = ['accounts', 'api_tokens', 'resource_grants'] as const
type LegacyTableName = typeof LEGACY_TABLE_NAMES[number]

export type LegacyForkArtifacts = {
    tables: LegacyTableName[]
    sessionsHasOwnerColumn: boolean
    machinesHasOwnerColumn: boolean
}

export type LegacyMigrationResult =
    | { kind: 'no-op'; reason: 'db-missing' | 'no-artifacts' }
    | {
        kind: 'migrated'
        accountsCopied: number
        tokensCopied: number
        resourcesCopied: number
        grantsCopied: number
        orphanedOwnerRows: number
        orphanedGrants: number
    }

type SqliteMasterRow = { name: string }

function readLegacyTables(db: Database): LegacyTableName[] {
    const placeholders = LEGACY_TABLE_NAMES.map(() => '?').join(', ')
    const rows = db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
    ).all(...LEGACY_TABLE_NAMES) as SqliteMasterRow[]
    const seen = new Set(rows.map(r => r.name))
    return LEGACY_TABLE_NAMES.filter(name => seen.has(name))
}

function hasColumn(db: Database, table: string, column: string): boolean {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return rows.some(row => row.name === column)
}

export function detectLegacyForkArtifacts(db: Database): LegacyForkArtifacts {
    return {
        tables: readLegacyTables(db),
        sessionsHasOwnerColumn: hasColumn(db, 'sessions', 'owner_account_id'),
        machinesHasOwnerColumn: hasColumn(db, 'machines', 'owner_account_id')
    }
}

export function hasAnyLegacyForkArtifacts(a: LegacyForkArtifacts): boolean {
    return a.tables.length > 0 || a.sessionsHasOwnerColumn || a.machinesHasOwnerColumn
}

type LegacyAccountRow = {
    id: number
    username: string
    password_hash: string | null
    role: string
    default_namespace: string
    disabled_at: number | null
}

type LegacyTokenRow = {
    account_id: number
    name: string | null
    token_hash: string
    created_at: number
    revoked_at: number | null
}

type LegacyGrantRow = {
    resource_type: string
    resource_id: string
    grantee_account_id: number
    role: string
}

type LegacyOwnerRow = {
    id: string
    namespace: string | null
    owner_account_id: number
}

function normalizeRole(role: string): 'admin' | 'user' {
    return role === 'admin' ? 'admin' : 'user'
}

function normalizeGrantRole(role: string): 'viewer' | 'operator' {
    return role === 'operator' ? 'operator' : 'viewer'
}

function normalizeResourceType(kind: string): 'session' | 'machine' | null {
    return kind === 'session' || kind === 'machine' ? kind : null
}

/**
 * One-shot idempotent migration of PR #102-era fork-only artifacts from
 * hapi-data.sqlite into the fork-features gateway store at
 * multi-user-gateway.sqlite, then removal of those artifacts from hapi-data
 * so subsequent boots see a clean upstream schema.
 *
 * Both hash algorithms (scrypt-encoded password_hash + sha256-hex token_hash)
 * are byte-identical to the fork era, so credentials survive unchanged.
 *
 * Called from startHub before `new Store(...)` and before
 * createMultiUserGatewayStore, so no other SQLite connection is open on
 * either file while this runs.
 */
export function migrateLegacyForkArtifacts(params: {
    hapiDataPath: string
    gatewayDataPath: string
}): LegacyMigrationResult {
    if (!existsSync(params.hapiDataPath)) {
        return { kind: 'no-op', reason: 'db-missing' }
    }

    const hapiDb = new Database(params.hapiDataPath, { readwrite: true })
    try {
        hapiDb.exec('PRAGMA foreign_keys = OFF')

        const artifacts = detectLegacyForkArtifacts(hapiDb)
        if (!hasAnyLegacyForkArtifacts(artifacts)) {
            return { kind: 'no-op', reason: 'no-artifacts' }
        }

        const gatewayDb = new Database(params.gatewayDataPath, { create: true })
        try {
            applyGatewaySchema(gatewayDb)

            const idMap = new Map<number, number>()
            let accountsCopied = 0
            let tokensCopied = 0
            let resourcesCopied = 0
            let grantsCopied = 0
            let orphanedOwnerRows = 0
            let orphanedGrants = 0

            if (artifacts.tables.includes('accounts')) {
                const rows = hapiDb.prepare(
                    'SELECT id, username, password_hash, role, default_namespace, disabled_at FROM accounts ORDER BY id'
                ).all() as LegacyAccountRow[]

                gatewayDb.transaction(() => {
                    const insertAccount = gatewayDb.prepare(
                        `INSERT INTO gateway_accounts (username, password_hash, role, default_namespace, disabled_at)
                         VALUES (?, ?, ?, ?, ?)
                         ON CONFLICT(username) DO NOTHING`
                    )
                    const lookupAccount = gatewayDb.prepare(
                        'SELECT id FROM gateway_accounts WHERE username = ?'
                    )
                    for (const row of rows) {
                        const result = insertAccount.run(
                            row.username,
                            row.password_hash,
                            normalizeRole(row.role),
                            row.default_namespace,
                            row.disabled_at
                        )
                        const newIdRow = lookupAccount.get(row.username) as { id: number } | undefined
                        if (newIdRow) {
                            idMap.set(row.id, newIdRow.id)
                            if (result.changes > 0) accountsCopied++
                        }
                    }
                })()
            }

            if (artifacts.tables.includes('api_tokens')) {
                const rows = hapiDb.prepare(
                    'SELECT account_id, name, token_hash, created_at, revoked_at FROM api_tokens'
                ).all() as LegacyTokenRow[]

                gatewayDb.transaction(() => {
                    const insertToken = gatewayDb.prepare(
                        `INSERT INTO gateway_api_tokens (account_id, name, token_hash, created_at, revoked_at)
                         VALUES (?, ?, ?, ?, ?)
                         ON CONFLICT(token_hash) DO NOTHING`
                    )
                    for (const row of rows) {
                        const newAccountId = idMap.get(row.account_id)
                        if (newAccountId === undefined) continue
                        const result = insertToken.run(
                            newAccountId,
                            row.name,
                            row.token_hash,
                            row.created_at,
                            row.revoked_at
                        )
                        if (result.changes > 0) tokensCopied++
                    }
                })()
            }

            if (artifacts.sessionsHasOwnerColumn || artifacts.machinesHasOwnerColumn) {
                gatewayDb.transaction(() => {
                    const insertResource = gatewayDb.prepare(
                        `INSERT INTO gateway_resources (resource_type, resource_id, owner_account_id, core_namespace)
                         VALUES (?, ?, ?, ?)
                         ON CONFLICT(resource_type, resource_id) DO NOTHING`
                    )

                    const migrateOwnerRows = (
                        table: 'sessions' | 'machines',
                        resourceType: 'session' | 'machine'
                    ) => {
                        const rows = hapiDb.prepare(
                            `SELECT id, namespace, owner_account_id FROM ${table} WHERE owner_account_id IS NOT NULL`
                        ).all() as LegacyOwnerRow[]
                        for (const row of rows) {
                            const newOwnerId = idMap.get(row.owner_account_id)
                            if (newOwnerId === undefined) {
                                orphanedOwnerRows++
                                continue
                            }
                            const result = insertResource.run(
                                resourceType,
                                row.id,
                                newOwnerId,
                                row.namespace ?? 'default'
                            )
                            if (result.changes > 0) resourcesCopied++
                        }
                    }

                    if (artifacts.sessionsHasOwnerColumn) migrateOwnerRows('sessions', 'session')
                    if (artifacts.machinesHasOwnerColumn) migrateOwnerRows('machines', 'machine')
                })()
            }

            if (artifacts.tables.includes('resource_grants')) {
                const rows = hapiDb.prepare(
                    'SELECT resource_type, resource_id, grantee_account_id, role FROM resource_grants'
                ).all() as LegacyGrantRow[]

                gatewayDb.transaction(() => {
                    const insertGrant = gatewayDb.prepare(
                        `INSERT INTO gateway_grants (resource_type, resource_id, grantee_account_id, role)
                         VALUES (?, ?, ?, ?)
                         ON CONFLICT(resource_type, resource_id, grantee_account_id) DO NOTHING`
                    )
                    for (const row of rows) {
                        const resourceType = normalizeResourceType(row.resource_type)
                        if (resourceType === null) { orphanedGrants++; continue }
                        const newGranteeId = idMap.get(row.grantee_account_id)
                        if (newGranteeId === undefined) { orphanedGrants++; continue }
                        try {
                            const result = insertGrant.run(
                                resourceType,
                                row.resource_id,
                                newGranteeId,
                                normalizeGrantRole(row.role)
                            )
                            if (result.changes > 0) grantsCopied++
                        } catch {
                            orphanedGrants++
                        }
                    }
                })()
            }

            // DDL below runs outside a wrapping transaction: SQLite's
            // ALTER TABLE DROP COLUMN (3.35+) rewrites the table and cannot
            // sit inside a BEGIN block. The order matters — drop dependent
            // indexes before their columns, and DROP tables in FK-child
            // order (grants→tokens→accounts) even with foreign_keys=OFF so
            // no lingering PRAGMA references remain.
            if (artifacts.tables.includes('resource_grants')) hapiDb.exec('DROP TABLE resource_grants')
            if (artifacts.tables.includes('api_tokens')) hapiDb.exec('DROP TABLE api_tokens')
            if (artifacts.tables.includes('accounts')) hapiDb.exec('DROP TABLE accounts')
            if (artifacts.sessionsHasOwnerColumn) {
                hapiDb.exec('DROP INDEX IF EXISTS idx_sessions_owner')
                hapiDb.exec('ALTER TABLE sessions DROP COLUMN owner_account_id')
            }
            if (artifacts.machinesHasOwnerColumn) {
                hapiDb.exec('DROP INDEX IF EXISTS idx_machines_owner')
                hapiDb.exec('ALTER TABLE machines DROP COLUMN owner_account_id')
            }

            return {
                kind: 'migrated',
                accountsCopied,
                tokensCopied,
                resourcesCopied,
                grantsCopied,
                orphanedOwnerRows,
                orphanedGrants
            }
        } finally {
            gatewayDb.close()
        }
    } finally {
        hapiDb.close()
    }
}

/**
 * Post-migration assertion: hapi-data.sqlite must no longer contain any
 * PR #102-era multi-user artifact. Called from startHub after both Store
 * and MultiUserGatewayStore are constructed, so a stale artifact — for
 * instance because migrateLegacyForkArtifacts was skipped or silently
 * failed to remove something — trips a loud startup error instead of a
 * silent-pass-through boot.
 */
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
        throw new Error(
            `Legacy fork multi-user artifacts still present in ${hapiDataPath}: ${parts.join('; ')}. ` +
            'Expected them to be migrated to multi-user-gateway.sqlite and cleared from hapi-data.sqlite ' +
            'by fork-features/multi-user/legacyDbCompat.'
        )
    } finally {
        db.close()
    }
}
