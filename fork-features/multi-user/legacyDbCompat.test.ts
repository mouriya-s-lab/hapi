import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it } from 'bun:test'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Store } from '../../hub/src/store'
import { applyGatewaySchema, MultiUserGatewayStore } from './gatewayStore'
import { resolveGatewayCliNamespace } from './cliAdapter'
import { ExecutionDispatcher } from './executionDispatcher'
import {
    assertNoLegacyForkArtifactsRemaining,
    detectLegacyForkArtifacts,
    hasAnyLegacyForkArtifacts,
    migrateLegacyForkArtifacts
} from './legacyDbCompat'
import { hashPassword } from './password'
import { hashApiToken } from './token'

const cleanupDirs: string[] = []
afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hapi-legacy-compat-'))
    cleanupDirs.push(dir)
    return dir
}

function readUserVersion(dbPath: string): number {
    const db = new Database(dbPath, { readonly: true })
    try {
        return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    } finally {
        db.close()
    }
}

/**
 * Builds the exact behavior-bearing schema differences introduced by PR #102
 * v10-v13 on top of the then-current core tables.
 */
function seedForkSchemaDb(dbPath: string, opts: {
    version?: 10 | 11 | 12 | 13
    adminUsername?: string
    adminPasswordHash?: string
    adminMemory?: string
    adminTokenHash?: string
    adminTokenNamespace?: string
    sessionOwners?: Array<{ id: string; namespace: string; ownerAccountId: number | null }>
    machineOwners?: Array<{ id: string; namespace: string; ownerAccountId: number | null }>
    extraAccounts?: Array<{ username: string; passwordHash: string | null; role: string; defaultNamespace: string }>
    grants?: Array<{ resourceType: string; resourceId: string; granteeAccountId: number; role: string }>
    externalIdentities?: Array<{ platform: string; platformUserId: string; accountId: number | null }>
    pushSubscriptionAccounts?: Array<{ namespace: string; endpoint: string; accountId: number }>
} = {}): void {
    const version = opts.version ?? 10
    const db = new Database(dbPath, { create: true, readwrite: true })
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')

    // Core tables carried by PR #102, including the session columns added in v13.
    db.exec(`
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY, tag TEXT, namespace TEXT NOT NULL DEFAULT 'default',
            machine_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            metadata TEXT, metadata_version INTEGER DEFAULT 1,
            agent_state TEXT, agent_state_version INTEGER DEFAULT 1,
            model TEXT, model_reasoning_effort TEXT, effort TEXT,
            ${version === 13 ? 'service_tier TEXT, resume_with_session_model INTEGER NOT NULL DEFAULT 0,' : ''}
            todos TEXT, todos_updated_at INTEGER,
            team_state TEXT, team_state_updated_at INTEGER,
            active INTEGER DEFAULT 0, active_at INTEGER, seq INTEGER DEFAULT 0,
            owner_account_id INTEGER
        );
        CREATE INDEX idx_sessions_tag ON sessions(tag);
        CREATE INDEX idx_sessions_tag_namespace ON sessions(tag, namespace);
        CREATE INDEX idx_sessions_owner ON sessions(owner_account_id);

        CREATE TABLE machines (
            id TEXT PRIMARY KEY, namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            metadata TEXT, metadata_version INTEGER DEFAULT 1,
            runner_state TEXT, runner_state_version INTEGER DEFAULT 1,
            active INTEGER DEFAULT 0, active_at INTEGER, seq INTEGER DEFAULT 0,
            owner_account_id INTEGER
        );
        CREATE INDEX idx_machines_namespace ON machines(namespace);
        CREATE INDEX idx_machines_owner ON machines(owner_account_id);

        CREATE TABLE messages (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, content TEXT NOT NULL,
            created_at INTEGER NOT NULL, seq INTEGER NOT NULL, local_id TEXT,
            invoked_at INTEGER, scheduled_at INTEGER,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL,
            platform_user_id TEXT NOT NULL, namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL${version >= 11 ? ', account_id INTEGER' : ''},
            UNIQUE(platform, platform_user_id)
        );

        CREATE TABLE push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, namespace TEXT NOT NULL,
            endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
            created_at INTEGER NOT NULL${version >= 11 ? ', account_id INTEGER' : ''},
            UNIQUE(namespace, endpoint)
        );

        CREATE TABLE accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT,
            auth_provider TEXT NOT NULL DEFAULT 'local',
            role TEXT NOT NULL DEFAULT 'user',
            default_namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            disabled_at INTEGER${version >= 12 ? ', memory TEXT' : ''}
        );

        CREATE TABLE api_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            name TEXT,
            token_hash TEXT NOT NULL UNIQUE,
            namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            last_used_at INTEGER,
            revoked_at INTEGER,
            FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        );

        CREATE TABLE resource_grants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            resource_type TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            grantee_account_id INTEGER NOT NULL,
            role TEXT NOT NULL DEFAULT 'viewer',
            created_at INTEGER NOT NULL,
            UNIQUE(resource_type, resource_id, grantee_account_id),
            FOREIGN KEY (grantee_account_id) REFERENCES accounts(id) ON DELETE CASCADE
        );

        PRAGMA user_version = ${version};
    `)

    const now = 1_700_000_000_000
    const adminUsername = opts.adminUsername ?? 'admin'
    const adminPasswordHash = opts.adminPasswordHash ?? null
    const adminInfo = db.prepare(
        'INSERT INTO accounts (username, password_hash, auth_provider, role, default_namespace, created_at, disabled_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'
    ).run(adminUsername, adminPasswordHash, 'local', 'admin', 'default', now)
    const adminId = Number(adminInfo.lastInsertRowid)
    if (version >= 12 && opts.adminMemory) {
        db.prepare('UPDATE accounts SET memory=? WHERE id=?').run(opts.adminMemory, adminId)
    }

    for (const extra of opts.extraAccounts ?? []) {
        db.prepare(
            'INSERT INTO accounts (username, password_hash, auth_provider, role, default_namespace, created_at, disabled_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'
        ).run(extra.username, extra.passwordHash, 'local', extra.role, extra.defaultNamespace, now)
    }

    if (opts.adminTokenHash) {
        db.prepare(
            'INSERT INTO api_tokens (account_id, name, token_hash, namespace, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL, NULL)'
        ).run(adminId, 'legacy shared token', opts.adminTokenHash, opts.adminTokenNamespace ?? 'default', now)
    }

    for (const session of opts.sessionOwners ?? []) {
        db.prepare(
            'INSERT INTO sessions (id, namespace, created_at, updated_at, seq, owner_account_id) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(session.id, session.namespace, now, now, 0, session.ownerAccountId)
    }
    for (const machine of opts.machineOwners ?? []) {
        db.prepare(
            'INSERT INTO machines (id, namespace, created_at, updated_at, seq, owner_account_id) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(machine.id, machine.namespace, now, now, 0, machine.ownerAccountId)
    }
    for (const grant of opts.grants ?? []) {
        db.prepare(
            'INSERT INTO resource_grants (resource_type, resource_id, grantee_account_id, role, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(grant.resourceType, grant.resourceId, grant.granteeAccountId, grant.role, now)
    }
    if (version >= 11) {
        for (const identity of opts.externalIdentities ?? []) {
            db.prepare(
                'INSERT INTO users(platform,platform_user_id,namespace,created_at,account_id) VALUES(?,?,?,?,?)'
            ).run(identity.platform, identity.platformUserId, 'default', now, identity.accountId)
        }
        for (const binding of opts.pushSubscriptionAccounts ?? []) {
            db.prepare(
                'INSERT INTO push_subscriptions(namespace,endpoint,p256dh,auth,created_at,account_id) VALUES(?,?,?,?,?,?)'
            ).run(binding.namespace, binding.endpoint, 'fixture-p256dh', 'fixture-auth', now, binding.accountId)
        }
    }

    db.close()
}

/** Same upstream 5 tables as seedForkSchemaDb but *without* any fork-only table or owner_account_id column. */
function seedBaselineDb(dbPath: string): void {
    const db = new Database(dbPath, { create: true, readwrite: true })
    db.exec('PRAGMA journal_mode = WAL')
    db.exec(`
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY, tag TEXT, namespace TEXT NOT NULL DEFAULT 'default',
            machine_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            metadata TEXT, metadata_version INTEGER DEFAULT 1,
            agent_state TEXT, agent_state_version INTEGER DEFAULT 1,
            model TEXT, model_reasoning_effort TEXT, effort TEXT, service_tier TEXT,
            resume_with_session_model INTEGER NOT NULL DEFAULT 0,
            todos TEXT, todos_updated_at INTEGER,
            team_state TEXT, team_state_updated_at INTEGER,
            active INTEGER DEFAULT 0, active_at INTEGER, seq INTEGER DEFAULT 0
        );
        CREATE TABLE machines (
            id TEXT PRIMARY KEY, namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            metadata TEXT, metadata_version INTEGER DEFAULT 1,
            runner_state TEXT, runner_state_version INTEGER DEFAULT 1,
            active INTEGER DEFAULT 0, active_at INTEGER, seq INTEGER DEFAULT 0
        );
        CREATE TABLE messages (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, content TEXT NOT NULL,
            created_at INTEGER NOT NULL, seq INTEGER NOT NULL, local_id TEXT,
            invoked_at INTEGER, scheduled_at INTEGER
        );
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL,
            platform_user_id TEXT NOT NULL, namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL, UNIQUE(platform, platform_user_id)
        );
        CREATE TABLE push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, namespace TEXT NOT NULL,
            endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
            created_at INTEGER NOT NULL, UNIQUE(namespace, endpoint)
        );
        PRAGMA user_version = 11;
    `)
    db.close()
}

describe('legacyDbCompat.detectLegacyForkArtifacts', () => {
    it('reports nothing on a baseline upstream DB', () => {
        const dir = makeTempDir()
        const dbPath = join(dir, 'hapi-data.sqlite')
        seedBaselineDb(dbPath)
        const db = new Database(dbPath, { readonly: true })
        try {
            const artifacts = detectLegacyForkArtifacts(db)
            expect(artifacts.tables).toEqual([])
            expect(artifacts.sessionsHasOwnerColumn).toBe(false)
            expect(artifacts.machinesHasOwnerColumn).toBe(false)
            expect(hasAnyLegacyForkArtifacts(artifacts)).toBe(false)
        } finally {
            db.close()
        }
    })

    it('reports every fork-only table and column on a fork-schema DB', () => {
        const dir = makeTempDir()
        const dbPath = join(dir, 'hapi-data.sqlite')
        seedForkSchemaDb(dbPath, {
            version: 12,
            sessionOwners: [{ id: 's1', namespace: 'default', ownerAccountId: 1 }]
        })
        const db = new Database(dbPath, { readonly: true })
        try {
            const artifacts = detectLegacyForkArtifacts(db)
            expect(artifacts.tables.sort()).toEqual(['accounts', 'api_tokens', 'resource_grants'])
            expect(artifacts.sessionsHasOwnerColumn).toBe(true)
            expect(artifacts.machinesHasOwnerColumn).toBe(true)
            expect(artifacts.usersHasAccountColumn).toBe(true)
            expect(artifacts.pushSubscriptionsHasAccountColumn).toBe(true)
            expect(artifacts.accountsHasMemoryColumn).toBe(true)
            expect(hasAnyLegacyForkArtifacts(artifacts)).toBe(true)
        } finally {
            db.close()
        }
    })
})

describe('legacyDbCompat.migrateLegacyForkArtifacts', () => {
    it('is a no-op when hapi-data.sqlite does not exist', () => {
        const dir = makeTempDir()
        const result = migrateLegacyForkArtifacts({
            hapiDataPath: join(dir, 'missing.sqlite'),
            gatewayDataPath: join(dir, 'gateway.sqlite')
        })
        expect(result).toEqual({ kind: 'no-op', reason: 'db-missing' })
        assertNoLegacyForkArtifactsRemaining(join(dir, 'missing.sqlite'))
        expect(existsSync(join(dir, 'gateway.sqlite'))).toBe(false)
    })

    it('is a no-op on a baseline upstream DB (no artifacts, no gateway file created)', () => {
        const dir = makeTempDir()
        const hapiPath = join(dir, 'hapi-data.sqlite')
        const gatewayPath = join(dir, 'gateway.sqlite')
        seedBaselineDb(hapiPath)
        const result = migrateLegacyForkArtifacts({ hapiDataPath: hapiPath, gatewayDataPath: gatewayPath })
        expect(result).toEqual({ kind: 'no-op', reason: 'no-artifacts' })
        expect(existsSync(gatewayPath)).toBe(false)
        assertNoLegacyForkArtifactsRemaining(hapiPath)
    })

    it('migrates accounts, tokens, resources, and grants; removes legacy artifacts; is idempotent', () => {
        const dir = makeTempDir()
        const hapiPath = join(dir, 'hapi-data.sqlite')
        const gatewayPath = join(dir, 'gateway.sqlite')
        const adminPasswordHash = hashPassword('correct-horse-battery-staple')
        const adminTokenHash = hashApiToken('legacy-token-plaintext')

        seedForkSchemaDb(hapiPath, {
            adminPasswordHash,
            adminTokenHash,
            adminTokenNamespace: 'tenant-blue',
            extraAccounts: [
                { username: 'alice', passwordHash: hashPassword('alice-pw'), role: 'user', defaultNamespace: 'default' }
            ],
            sessionOwners: [
                { id: 's-admin', namespace: 'default', ownerAccountId: 1 },
                { id: 's-alice', namespace: 'default', ownerAccountId: 2 },
                { id: 's-unowned', namespace: 'default', ownerAccountId: null }
            ],
            machineOwners: [
                { id: 'm-admin', namespace: 'default', ownerAccountId: 1 }
            ],
            grants: [
                { resourceType: 'session', resourceId: 's-admin', granteeAccountId: 2, role: 'operator' }
            ]
        })

        const result = migrateLegacyForkArtifacts({ hapiDataPath: hapiPath, gatewayDataPath: gatewayPath })
        expect(result.kind).toBe('migrated')
        if (result.kind !== 'migrated') return
        expect(result.accountsCopied).toBe(2)
        expect(result.tokensCopied).toBe(1)
        expect(result.resourcesCopied).toBe(3)
        expect(result.grantsCopied).toBe(1)
        expect(result.normalizedCoreVersion).toBe(9)

        const gateway = new MultiUserGatewayStore(gatewayPath)
        try {
            const admin = gateway.getAccountByUsername('admin')
            const alice = gateway.getAccountByUsername('alice')
            expect(admin).toMatchObject({ username: 'admin', role: 'admin', defaultNamespace: 'default' })
            expect(admin?.passwordHash).toBe(adminPasswordHash)
            expect(alice).toMatchObject({ username: 'alice', role: 'user' })

            const activeToken = gateway.getActiveTokenByHash(adminTokenHash)
            expect(activeToken).not.toBeNull()
            expect(activeToken?.accountId).toBe(admin!.id)
            expect(activeToken?.namespace).toBe('tenant-blue')

            const sessionResource = gateway.getResource('session', 's-admin')
            expect(sessionResource).toMatchObject({ resourceType: 'session', resourceId: 's-admin', ownerAccountId: admin!.id })
            const machineResource = gateway.getResource('machine', 'm-admin')
            expect(machineResource?.ownerAccountId).toBe(admin!.id)
            expect(gateway.listAccessibleResources('session', admin!.id).map(resource => resource.resourceId))
                .toEqual(['s-admin', 's-alice'])

            expect(gateway.getGrant('session', 's-admin', alice!.id)).toBe('operator')
        } finally {
            gateway.close()
        }

        assertNoLegacyForkArtifactsRemaining(hapiPath)

        // Idempotent: second migrate is a no-op even though the gateway file already exists.
        const again = migrateLegacyForkArtifacts({ hapiDataPath: hapiPath, gatewayDataPath: gatewayPath })
        expect(again).toEqual({ kind: 'no-op', reason: 'no-artifacts' })
    })

    it('rejects missing account references before removing source artifacts', () => {
        const dir = makeTempDir()
        const hapiPath = join(dir, 'hapi-data.sqlite')
        const gatewayPath = join(dir, 'gateway.sqlite')

        seedForkSchemaDb(hapiPath, {
            sessionOwners: [
                { id: 's-good', namespace: 'default', ownerAccountId: 1 },
                { id: 's-orphan', namespace: 'default', ownerAccountId: 999 }
            ]
        })

        const result = migrateLegacyForkArtifacts({ hapiDataPath: hapiPath, gatewayDataPath: gatewayPath })
        expect(result.kind).toBe('rejected')
        if (result.kind !== 'rejected') return
        expect(result.conflicts).toContain('session#s-orphan.owner_account_id references missing accounts#999')

        const source = new Database(hapiPath, { readonly: true })
        try {
            expect(detectLegacyForkArtifacts(source).sessionsHasOwnerColumn).toBe(true)
            expect(source.prepare('SELECT COUNT(*) AS count FROM accounts').get()).toEqual({ count: 1 })
        } finally {
            source.close()
        }
    })

    it('rolls back all source cleanup when a later schema normalization step fails', () => {
        const dir = makeTempDir()
        const hapiPath = join(dir, 'hapi-data.sqlite')
        const gatewayPath = join(dir, 'gateway.sqlite')
        seedForkSchemaDb(hapiPath, {
            version: 13,
            sessionOwners: [{ id: 's1', namespace: 'default', ownerAccountId: 1 }],
            machineOwners: [{ id: 'm1', namespace: 'default', ownerAccountId: 1 }]
        })
        const source = new Database(hapiPath)
        source.exec('CREATE INDEX block_machine_owner_drop ON machines(owner_account_id)')
        source.close()

        expect(() => migrateLegacyForkArtifacts({
            hapiDataPath: hapiPath,
            gatewayDataPath: gatewayPath
        })).toThrow()

        const afterFailure = new Database(hapiPath, { readonly: true })
        try {
            const artifacts = detectLegacyForkArtifacts(afterFailure)
            expect(artifacts.tables.sort()).toEqual(['accounts', 'api_tokens', 'resource_grants'])
            expect(artifacts.sessionsHasOwnerColumn).toBe(true)
            expect(artifacts.machinesHasOwnerColumn).toBe(true)
            expect(artifacts.usersHasAccountColumn).toBe(true)
            expect(artifacts.pushSubscriptionsHasAccountColumn).toBe(true)
            expect(artifacts.userVersion).toBe(13)
        } finally {
            afterFailure.close()
        }

        const repair = new Database(hapiPath)
        repair.exec('DROP INDEX block_machine_owner_drop')
        repair.close()
        expect(migrateLegacyForkArtifacts({
            hapiDataPath: hapiPath,
            gatewayDataPath: gatewayPath
        }).kind).toBe('migrated')
        assertNoLegacyForkArtifactsRemaining(hapiPath)
    })

    it('rejects a same-username gateway account with different behavior before removing source data', () => {
        const dir = makeTempDir()
        const hapiPath = join(dir, 'hapi-data.sqlite')
        const gatewayPath = join(dir, 'gateway.sqlite')

        const preexistingGateway = new MultiUserGatewayStore(gatewayPath)
        preexistingGateway.createAccount('admin', 'admin', 'default', hashPassword('pre-existing'))
        preexistingGateway.close()

        seedForkSchemaDb(hapiPath, {
            adminPasswordHash: hashPassword('legacy-different-password'),
            sessionOwners: [{ id: 's1', namespace: 'default', ownerAccountId: 1 }]
        })

        const result = migrateLegacyForkArtifacts({ hapiDataPath: hapiPath, gatewayDataPath: gatewayPath })
        expect(result.kind).toBe('rejected')
        if (result.kind !== 'rejected') return
        expect(result.conflicts[0]).toContain('accounts username=admin conflicts')

        const source = new Database(hapiPath, { readonly: true })
        try {
            expect(detectLegacyForkArtifacts(source).tables).toContain('accounts')
            expect(detectLegacyForkArtifacts(source).sessionsHasOwnerColumn).toBe(true)
        } finally {
            source.close()
        }
    })

    it('preserves v12 memory, token namespace, and v11 account bindings behind gateway APIs', () => {
        const dir = makeTempDir()
        const hapiPath = join(dir, 'hapi-data.sqlite')
        const gatewayPath = join(dir, 'gateway.sqlite')
        const tokenHash = hashApiToken('namespace-token')
        seedForkSchemaDb(hapiPath, {
            version: 12,
            adminMemory: 'Use the lab machine',
            adminTokenHash: tokenHash,
            adminTokenNamespace: 'tenant-blue',
            sessionOwners: [{ id: 's1', namespace: 'tenant-blue', ownerAccountId: 1 }],
            externalIdentities: [
                { platform: 'telegram', platformUserId: '42', accountId: 1 },
                { platform: 'telegram', platformUserId: 'legacy-admin', accountId: null }
            ],
            pushSubscriptionAccounts: [{ namespace: 'tenant-blue', endpoint: 'https://push.test/admin', accountId: 1 }]
        })

        const result = migrateLegacyForkArtifacts({ hapiDataPath: hapiPath, gatewayDataPath: gatewayPath })
        expect(result).toMatchObject({
            kind: 'migrated',
            sourceVersion: 12,
            normalizedCoreVersion: 9,
            externalIdentitiesCopied: 2,
            pushSubscriptionAccountsCopied: 1
        })

        const gateway = new MultiUserGatewayStore(gatewayPath)
        try {
            const admin = gateway.getAccountByUsername('admin')!
            expect(admin.memory).toBe('Use the lab machine')
            expect(gateway.getActiveTokenByHash(tokenHash)?.namespace).toBe('tenant-blue')
            expect(gateway.getExternalIdentity('telegram', '42')?.accountId).toBe(admin.id)
            expect(gateway.getExternalIdentity('telegram', 'legacy-admin')?.accountId).toBe(admin.id)
            expect(gateway.getPushSubscriptionAccount('tenant-blue', 'https://push.test/admin')?.accountId).toBe(admin.id)
        } finally {
            gateway.close()
        }
    })

    for (const version of [10, 11, 12, 13] as const) {
        it(`normalizes PR #102 schema v${version} into the current Store schema`, () => {
            const dir = makeTempDir()
            const hapiPath = join(dir, 'hapi-data.sqlite')
            const gatewayPath = join(dir, 'gateway.sqlite')
            seedForkSchemaDb(hapiPath, {
                version,
                sessionOwners: [{ id: `s-v${version}`, namespace: 'default', ownerAccountId: 1 }]
            })

            const result = migrateLegacyForkArtifacts({ hapiDataPath: hapiPath, gatewayDataPath: gatewayPath })
            expect(result.kind).toBe('migrated')
            if (result.kind !== 'migrated') return
            expect(result.normalizedCoreVersion).toBe(version === 13 ? 10 : 9)
            const store = new Store(hapiPath)
            store.close()
            const currentStorePath = join(dir, 'current-store.sqlite')
            const currentStore = new Store(currentStorePath)
            currentStore.close()

            const normalized = new Database(hapiPath, { readonly: true })
            try {
                const versionRow = normalized.prepare('PRAGMA user_version').get() as { user_version: number }
                expect(versionRow.user_version).toBe(readUserVersion(currentStorePath))
                const columns = normalized.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
                expect(columns.some(column => column.name === 'service_tier')).toBe(true)
                expect(columns.some(column => column.name === 'resume_with_session_model')).toBe(true)
            } finally {
                normalized.close()
            }
        })
    }
})

describe('legacyDbCompat.assertNoLegacyForkArtifactsRemaining', () => {
    it('throws a descriptive error listing every remaining fork artifact', () => {
        const dir = makeTempDir()
        const hapiPath = join(dir, 'hapi-data.sqlite')
        seedForkSchemaDb(hapiPath)
        expect(() => assertNoLegacyForkArtifactsRemaining(hapiPath)).toThrow(/accounts/)
        expect(() => assertNoLegacyForkArtifactsRemaining(hapiPath)).toThrow(/sessions\.owner_account_id/)
        expect(() => assertNoLegacyForkArtifactsRemaining(hapiPath)).toThrow(/machines\.owner_account_id/)
    })
})

describe('legacyDbCompat against real fork-era fixture (commit 2ca4a1979 seed output)', () => {
    // fork-era-hapi-data.sqlite was produced by running seed-fork-era-fixture.ts.reference
    // against fork commit 2ca4a1979's own hub/src/store/*. See __fixtures__ dir for reproducing
    // instructions. Data shape:
    //   accounts: admin (id=1), alice (id=2)
    //   api_tokens: admin's shared token, alice's phone token
    //   sessions: 2 rows, both owner_account_id=1
    //   machines: 1 row, owner_account_id=1
    //   resource_grants: session→alice (operator), machine→alice (viewer)
    //   messages: 3 rows
    //   PRAGMA user_version = 10
    const fixtureUrl = new URL('./__fixtures__/fork-era-hapi-data.sqlite', import.meta.url)
    const fixturePath = fileURLToPath(fixtureUrl)

    it('migrates all real fork-era rows into the gateway and clears them from hapi-data', () => {
        const dir = makeTempDir()
        const hapiPath = join(dir, 'hapi-data.sqlite')
        const gatewayPath = join(dir, 'multi-user-gateway.sqlite')
        copyFileSync(fixturePath, hapiPath)

        // Sanity: fixture actually has the fork-era shape before we touch it.
        const preRead = new Database(hapiPath, { readonly: true })
        const coreQueries = [
            `SELECT id, tag, namespace, machine_id, created_at, updated_at, metadata, metadata_version,
                agent_state, agent_state_version, model, model_reasoning_effort, effort, todos,
                todos_updated_at, team_state, team_state_updated_at, active, active_at, seq
                FROM sessions ORDER BY id`,
            `SELECT id, namespace, created_at, updated_at, metadata, metadata_version,
                runner_state, runner_state_version, active, active_at, seq FROM machines ORDER BY id`,
            'SELECT * FROM messages ORDER BY id',
            'SELECT * FROM users ORDER BY id',
            'SELECT * FROM push_subscriptions ORDER BY id'
        ]
        const originalCoreRows = coreQueries.map(query => preRead.prepare(query).all())
        try {
            const artifacts = detectLegacyForkArtifacts(preRead)
            expect(artifacts.tables.sort()).toEqual(['accounts', 'api_tokens', 'resource_grants'])
            expect(artifacts.sessionsHasOwnerColumn).toBe(true)
            expect(artifacts.machinesHasOwnerColumn).toBe(true)
            expect((preRead.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(10)
            expect((preRead.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n).toBe(2)
            expect((preRead.prepare('SELECT COUNT(*) AS n FROM api_tokens').get() as { n: number }).n).toBe(2)
            expect((preRead.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(2)
            expect((preRead.prepare('SELECT COUNT(*) AS n FROM machines').get() as { n: number }).n).toBe(1)
            expect((preRead.prepare('SELECT COUNT(*) AS n FROM resource_grants').get() as { n: number }).n).toBe(2)
            expect((preRead.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n).toBe(3)
        } finally {
            preRead.close()
        }

        const result = migrateLegacyForkArtifacts({ hapiDataPath: hapiPath, gatewayDataPath: gatewayPath })
        expect(result.kind).toBe('migrated')
        if (result.kind !== 'migrated') return
        expect(result.accountsCopied).toBe(2)
        expect(result.tokensCopied).toBe(2)
        expect(result.resourcesCopied).toBe(3)
        expect(result.grantsCopied).toBe(2)

        // Gateway side has the migrated data
        const gateway = new MultiUserGatewayStore(gatewayPath)
        try {
            const admin = gateway.getAccountByUsername('admin')
            const alice = gateway.getAccountByUsername('alice')
            expect(admin?.role).toBe('admin')
            expect(alice?.role).toBe('user')
            expect(admin?.passwordHash?.startsWith('scrypt$')).toBe(true)

            // Both sessions and the machine now sit in gateway_resources
            const sessionRes = gateway.listAccessibleResources('session', admin!.id)
            expect(sessionRes).toHaveLength(2)
            expect(sessionRes.every(r => r.ownerAccountId === admin!.id)).toBe(true)
            const machineRes = gateway.listAccessibleResources('machine', admin!.id)
            expect(machineRes).toHaveLength(1)

            const sharedSessionId = '694b4036-1bf5-476a-b325-0cd1c7384cb6'
            const privateSessionId = 'f704b6bb-7e4a-4f17-bebd-4d04d7f60c3c'
            const machineId = 'machine-fixture-1'
            expect(gateway.listAccessibleResources('session', alice!.id)).toEqual([{
                resourceType: 'session', resourceId: sharedSessionId,
                ownerAccountId: admin!.id, coreNamespace: 'default'
            }])
            expect(gateway.listAccessibleResources('machine', alice!.id)).toEqual([{
                resourceType: 'machine', resourceId: machineId,
                ownerAccountId: admin!.id, coreNamespace: 'default'
            }])
            expect(gateway.listGrants('session', sharedSessionId)).toEqual([{ accountId: alice!.id, role: 'operator' }])
            expect(gateway.listGrants('machine', machineId)).toEqual([{ accountId: alice!.id, role: 'viewer' }])
            const dispatcher = new ExecutionDispatcher(gateway)
            expect(dispatcher.authorize({
                accountId: alice!.id, capability: 'operate', resource: { type: 'session', id: sharedSessionId }
            }).kind).toBe('allow')
            expect(dispatcher.authorize({
                accountId: alice!.id, capability: 'operate', resource: { type: 'machine', id: machineId }
            })).toEqual({ kind: 'deny', reason: 'insufficient-access' })
            expect(dispatcher.authorize({
                accountId: alice!.id, capability: 'read', resource: { type: 'session', id: privateSessionId }
            })).toEqual({ kind: 'deny', reason: 'insufficient-access' })
            expect(resolveGatewayCliNamespace(gateway, 'fixture-alice-token-plaintext')).toBe('default')
            expect(resolveGatewayCliNamespace(gateway, 'fixture-shared-token-plaintext-do-not-hash-me-elsewhere')).toBe('default')
        } finally {
            gateway.close()
        }

        // hapi-data has been stripped of every fork-era artifact
        assertNoLegacyForkArtifactsRemaining(hapiPath)
        const post = new Database(hapiPath, { readonly: true })
        try {
            const sessionCols = post.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
            expect(sessionCols.some(c => c.name === 'owner_account_id')).toBe(false)
            const machineCols = post.prepare('PRAGMA table_info(machines)').all() as Array<{ name: string }>
            expect(machineCols.some(c => c.name === 'owner_account_id')).toBe(false)

            expect(coreQueries.map(query => post.prepare(query).all())).toEqual(originalCoreRows)
        } finally {
            post.close()
        }
    })
})

describe('legacyDbCompat integration with applyGatewaySchema', () => {
    it('backfills existing gateway token namespaces from their accounts', () => {
        const dir = makeTempDir()
        const gatewayPath = join(dir, 'gateway.sqlite')
        const db = new Database(gatewayPath, { create: true })
        try {
            db.exec(`
                CREATE TABLE gateway_accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT,
                    role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
                    default_namespace TEXT NOT NULL,
                    disabled_at INTEGER,
                    memory TEXT
                );
                CREATE TABLE gateway_api_tokens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_id INTEGER NOT NULL REFERENCES gateway_accounts(id) ON DELETE CASCADE,
                    name TEXT,
                    token_hash TEXT NOT NULL UNIQUE,
                    created_at INTEGER NOT NULL,
                    revoked_at INTEGER
                );
                INSERT INTO gateway_accounts(id,username,role,default_namespace)
                VALUES(7,'alice','user','tenant-blue');
                INSERT INTO gateway_api_tokens(account_id,name,token_hash,created_at)
                VALUES(7,'runner','hash',123);
            `)
            applyGatewaySchema(db)
            expect(
                (db.prepare('SELECT namespace FROM gateway_api_tokens WHERE id=1').get() as { namespace: string }).namespace
            ).toBe('tenant-blue')
        } finally {
            db.close()
        }
    })
})
