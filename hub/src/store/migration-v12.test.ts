import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

/**
 * Tests the complete V11→current multi-user migration, including channel
 * account attribution added in V13.
 * Mirrors migration-v9.test.ts.
 */
describe('Store V11→current migration: multi-user', () => {
    it('fresh DB has the new columns and tables', () => {
        const store = new Store(':memory:')
        try {
            expect(getColumns(store, 'machines')).toContain('owner_account_id')
            expect(getColumns(store, 'sessions')).toContain('owner_account_id')
            expect(getColumns(store, 'users')).toContain('account_id')
            expect(getColumns(store, 'push_subscriptions')).toContain('account_id')
            expect(tableExists(store, 'accounts')).toBe(true)
            expect(tableExists(store, 'api_tokens')).toBe(true)
            expect(tableExists(store, 'resource_grants')).toBe(true)
        } finally {
            store.close()
        }
    })

    it('V11 DB migrates through V13 with ownership and channel account columns', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v12-test-'))
        const dbPath = join(dir, 'test.db')
        let store: Store | undefined
        try {
            const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
            db.exec('PRAGMA journal_mode = WAL')
            db.exec('PRAGMA foreign_keys = ON')
            createV11Schema(db)
            db.exec('PRAGMA user_version = 11')
            db.exec(`INSERT INTO sessions (id, namespace, created_at, updated_at, seq)
                     VALUES ('s1', 'default', 1000, 1000, 0)`)
            db.exec(`INSERT INTO machines (id, namespace, created_at, updated_at, seq)
                     VALUES ('m1', 'default', 1000, 1000, 0)`)
            db.close()

            store = new Store(dbPath)
            // Columns added.
            expect(getColumns(store, 'machines')).toContain('owner_account_id')
            expect(getColumns(store, 'sessions')).toContain('owner_account_id')
            expect(getColumns(store, 'users')).toContain('account_id')
            expect(getColumns(store, 'push_subscriptions')).toContain('account_id')
            // Pre-existing rows keep working and have no owner yet.
            expect(store.machines.getMachine('m1')?.ownerAccountId ?? null).toBeNull()
            expect(store.sessions.getSession('s1')?.ownerAccountId ?? null).toBeNull()
            // New tables exist and are empty.
            expect(tableExists(store, 'accounts')).toBe(true)
            expect(store.accounts.count()).toBe(0)
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('V12 partial DB without channel tables migrates to the current schema', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v12-partial-'))
        const dbPath = join(dir, 'test.db')
        let store: Store | undefined
        try {
            const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
            createV11Schema(db)
            db.exec('DROP TABLE users; DROP TABLE push_subscriptions; PRAGMA user_version = 0')
            db.close()

            store = new Store(dbPath)
            expect(getColumns(store, 'users')).toContain('account_id')
            expect(getColumns(store, 'push_subscriptions')).toContain('account_id')
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('backfill assigns ownership to pre-existing rows', () => {
        const store = new Store(':memory:')
        try {
            const admin = store.accounts.create({
                username: 'admin', passwordHash: null, role: 'admin', defaultNamespace: 'default'
            })
            store.machines.getOrCreateMachine('m1', { path: '/a', host: 'h' }, null, 'default')
            store.sessions.getOrCreateSession('tag1', { path: '/a', host: 'h' }, null, 'default')

            expect(store.machines.getMachine('m1')?.ownerAccountId ?? null).toBeNull()

            const mCount = store.machines.backfillMachineOwners(admin.id)
            const sCount = store.sessions.backfillSessionOwners(admin.id)
            expect(mCount).toBe(1)
            expect(sCount).toBe(1)
            expect(store.machines.getMachine('m1')?.ownerAccountId).toBe(admin.id)
        } finally {
            store.close()
        }
    })
})

function getColumns(store: Store, table: string): string[] {
    // @ts-expect-error reach into the private db for test introspection
    const rows = store.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return rows.map((r) => r.name)
}

function tableExists(store: Store, table: string): boolean {
    // @ts-expect-error reach into the private db for test introspection
    const row = store.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(table) as { name?: string } | undefined
    return Boolean(row?.name)
}

function createV11Schema(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            tag TEXT,
            namespace TEXT NOT NULL DEFAULT 'default',
            machine_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            metadata TEXT,
            metadata_version INTEGER DEFAULT 1,
            agent_state TEXT,
            agent_state_version INTEGER DEFAULT 1,
            model TEXT,
            model_reasoning_effort TEXT,
            effort TEXT,
            service_tier TEXT,
            resume_with_session_model INTEGER NOT NULL DEFAULT 0,
            todos TEXT,
            todos_updated_at INTEGER,
            team_state TEXT,
            team_state_updated_at INTEGER,
            active INTEGER DEFAULT 0,
            active_at INTEGER,
            seq INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS machines (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            metadata TEXT,
            metadata_version INTEGER DEFAULT 1,
            runner_state TEXT,
            runner_state_version INTEGER DEFAULT 1,
            active INTEGER DEFAULT 0,
            active_at INTEGER,
            seq INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            seq INTEGER NOT NULL,
            local_id TEXT,
            invoked_at INTEGER,
            scheduled_at INTEGER,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            platform_user_id TEXT NOT NULL,
            namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            UNIQUE(platform, platform_user_id)
        );
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            namespace TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(namespace, endpoint)
        );
    `)
}
