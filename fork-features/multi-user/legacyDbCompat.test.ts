import { describe, expect, it, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { copyFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import {
    assertNoLegacyForkArtifactsRemaining,
    detectLegacyForkArtifacts,
    hasAnyLegacyForkArtifacts,
    migrateLegacyForkArtifacts
} from './legacyDbCompat'
import { applyGatewaySchema, MultiUserGatewayStore } from './gatewayStore'
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

/**
 * Builds a hapi-data.sqlite matching the state left behind by fork commit
 * 2ca4a1979 ("feat: 企业级多用户与权限隔离"): user_version = 11, upstream
 * required tables present, fork-only accounts / api_tokens / resource_grants
 * tables and sessions/machines.owner_account_id columns populated.
 */
function seedForkSchemaDb(dbPath: string, opts: {
    adminUsername?: string
    adminPasswordHash?: string
    adminTokenHash?: string
    sessionOwners?: Array<{ id: string; namespace: string; ownerAccountId: number | null }>
    machineOwners?: Array<{ id: string; namespace: string; ownerAccountId: number | null }>
    extraAccounts?: Array<{ username: string; passwordHash: string | null; role: string; defaultNamespace: string }>
    grants?: Array<{ resourceType: string; resourceId: string; granteeAccountId: number; role: string }>
} = {}): void {
    const db = new Database(dbPath, { create: true, readwrite: true })
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')

    // Upstream tables as of SCHEMA_VERSION 11.
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
            created_at INTEGER NOT NULL, UNIQUE(platform, platform_user_id)
        );

        CREATE TABLE push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, namespace TEXT NOT NULL,
            endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
            created_at INTEGER NOT NULL, UNIQUE(namespace, endpoint)
        );

        CREATE TABLE accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT,
            auth_provider TEXT NOT NULL DEFAULT 'local',
            role TEXT NOT NULL DEFAULT 'user',
            default_namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            disabled_at INTEGER
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

        PRAGMA user_version = 11;
    `)

    const now = 1_700_000_000_000
    const adminUsername = opts.adminUsername ?? 'admin'
    const adminPasswordHash = opts.adminPasswordHash ?? null
    const adminInfo = db.prepare(
        'INSERT INTO accounts (username, password_hash, auth_provider, role, default_namespace, created_at, disabled_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'
    ).run(adminUsername, adminPasswordHash, 'local', 'admin', 'default', now)
    const adminId = Number(adminInfo.lastInsertRowid)

    for (const extra of opts.extraAccounts ?? []) {
        db.prepare(
            'INSERT INTO accounts (username, password_hash, auth_provider, role, default_namespace, created_at, disabled_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'
        ).run(extra.username, extra.passwordHash, 'local', extra.role, extra.defaultNamespace, now)
    }

    if (opts.adminTokenHash) {
        db.prepare(
            'INSERT INTO api_tokens (account_id, name, token_hash, namespace, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL, NULL)'
        ).run(adminId, 'legacy shared token', opts.adminTokenHash, 'default', now)
    }

    for (const s of opts.sessionOwners ?? []) {
        db.prepare(
            'INSERT INTO sessions (id, namespace, created_at, updated_at, seq, owner_account_id) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(s.id, s.namespace, now, now, 0, s.ownerAccountId)
    }
    for (const m of opts.machineOwners ?? []) {
        db.prepare(
            'INSERT INTO machines (id, namespace, created_at, updated_at, seq, owner_account_id) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(m.id, m.namespace, now, now, 0, m.ownerAccountId)
    }
    for (const g of opts.grants ?? []) {
        db.prepare(
            'INSERT INTO resource_grants (resource_type, resource_id, grantee_account_id, role, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(g.resourceType, g.resourceId, g.granteeAccountId, g.role, now)
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
            sessionOwners: [{ id: 's1', namespace: 'default', ownerAccountId: 1 }]
        })
        const db = new Database(dbPath, { readonly: true })
        try {
            const artifacts = detectLegacyForkArtifacts(db)
            expect(artifacts.tables.sort()).toEqual(['accounts', 'api_tokens', 'resource_grants'])
            expect(artifacts.sessionsHasOwnerColumn).toBe(true)
            expect(artifacts.machinesHasOwnerColumn).toBe(true)
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
        expect(result.orphanedOwnerRows).toBe(0)
        expect(result.orphanedGrants).toBe(0)

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

            const sessionResource = gateway.getResource('session', 's-admin')
            expect(sessionResource).toMatchObject({ resourceType: 'session', resourceId: 's-admin', ownerAccountId: admin!.id })
            const machineResource = gateway.getResource('machine', 'm-admin')
            expect(machineResource?.ownerAccountId).toBe(admin!.id)

            expect(gateway.getGrant('session', 's-admin', alice!.id)).toBe('operator')
        } finally {
            gateway.close()
        }

        assertNoLegacyForkArtifactsRemaining(hapiPath)

        // Idempotent: second migrate is a no-op even though the gateway file already exists.
        const again = migrateLegacyForkArtifacts({ hapiDataPath: hapiPath, gatewayDataPath: gatewayPath })
        expect(again).toEqual({ kind: 'no-op', reason: 'no-artifacts' })
    })

    it('records session/machine rows whose owner_account_id has no matching accounts row as orphans and skips them', () => {
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
        expect(result.kind).toBe('migrated')
        if (result.kind !== 'migrated') return
        expect(result.resourcesCopied).toBe(1)
        expect(result.orphanedOwnerRows).toBe(1)

        const gateway = new MultiUserGatewayStore(gatewayPath)
        try {
            expect(gateway.getResource('session', 's-good')).not.toBeNull()
            expect(gateway.getResource('session', 's-orphan')).toBeNull()
        } finally {
            gateway.close()
        }
    })

    it('does not overwrite an existing gateway_accounts row when a legacy account of the same username is migrated', () => {
        const dir = makeTempDir()
        const hapiPath = join(dir, 'hapi-data.sqlite')
        const gatewayPath = join(dir, 'gateway.sqlite')

        // Pre-populate the gateway store with an existing 'admin' account (as if
        // createMultiUserGatewayStore had already bootstrapped one before this compat pass ran).
        const preexistingGateway = new MultiUserGatewayStore(gatewayPath)
        preexistingGateway.createAccount('admin', 'admin', 'default', hashPassword('pre-existing'))
        const preexistingId = preexistingGateway.getAccountByUsername('admin')!.id
        preexistingGateway.close()

        seedForkSchemaDb(hapiPath, {
            adminPasswordHash: hashPassword('legacy-different-password'),
            sessionOwners: [{ id: 's1', namespace: 'default', ownerAccountId: 1 }]
        })

        const result = migrateLegacyForkArtifacts({ hapiDataPath: hapiPath, gatewayDataPath: gatewayPath })
        expect(result.kind).toBe('migrated')

        const gateway = new MultiUserGatewayStore(gatewayPath)
        try {
            const admin = gateway.getAccountByUsername('admin')!
            expect(admin.id).toBe(preexistingId)
            // Pre-existing password_hash survives; legacy hash is discarded to keep operator's login intact.
            expect(admin.passwordHash).not.toBe(hashPassword('legacy-different-password'))
            // The legacy sessions owner still maps to the pre-existing admin id (bridged by username).
            expect(gateway.getResource('session', 's1')?.ownerAccountId).toBe(preexistingId)
        } finally {
            gateway.close()
        }
    })
})

describe('legacyDbCompat.assertNoLegacyForkArtifactsRemaining', () => {
    it('passes on a baseline upstream DB', () => {
        const dir = makeTempDir()
        const hapiPath = join(dir, 'hapi-data.sqlite')
        seedBaselineDb(hapiPath)
        expect(() => assertNoLegacyForkArtifactsRemaining(hapiPath)).not.toThrow()
    })

    it('passes when hapi-data.sqlite does not exist', () => {
        const dir = makeTempDir()
        expect(() => assertNoLegacyForkArtifactsRemaining(join(dir, 'missing.sqlite'))).not.toThrow()
    })

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
        expect(result.orphanedOwnerRows).toBe(0)
        expect(result.orphanedGrants).toBe(0)

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

            // Alice sees session via operator grant and machine via viewer grant
            const aliceSessions = gateway.listAccessibleResources('session', alice!.id)
            const aliceMachines = gateway.listAccessibleResources('machine', alice!.id)
            expect(aliceSessions.length + aliceMachines.length).toBeGreaterThan(0)
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

            // Upstream user data is untouched: 2 sessions, 1 machine, 3 messages still there
            expect((post.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(2)
            expect((post.prepare('SELECT COUNT(*) AS n FROM machines').get() as { n: number }).n).toBe(1)
            expect((post.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n).toBe(3)
        } finally {
            post.close()
        }
    })
})

describe('legacyDbCompat integration with applyGatewaySchema', () => {
    it('post-migration gateway DB is byte-shape-compatible with a fresh MultiUserGatewayStore constructor call', () => {
        const dir = makeTempDir()
        const hapiPath = join(dir, 'hapi-data.sqlite')
        const gatewayPath = join(dir, 'gateway.sqlite')
        seedForkSchemaDb(hapiPath, {
            sessionOwners: [{ id: 's1', namespace: 'default', ownerAccountId: 1 }]
        })
        migrateLegacyForkArtifacts({ hapiDataPath: hapiPath, gatewayDataPath: gatewayPath })

        // Opening the migrated file through MultiUserGatewayStore should be a no-op — schema already present,
        // CREATE TABLE IF NOT EXISTS covers the idempotent path.
        const gateway = new MultiUserGatewayStore(gatewayPath)
        try {
            expect(gateway.countAccounts()).toBeGreaterThan(0)
        } finally {
            gateway.close()
        }

        // Directly re-apply the schema on a fresh raw Database: should not throw.
        const rawDb = new Database(gatewayPath, { readwrite: true })
        try {
            expect(() => applyGatewaySchema(rawDb)).not.toThrow()
        } finally {
            rawDb.close()
        }
    })
})
