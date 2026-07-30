import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

describe('Store V10→V11 migration: fcm_devices', () => {
    it('fresh DB has fcm_devices table', () => {
        const store = new Store(':memory:')
        expect(tableExists(store, 'fcm_devices')).toBe(true)
    })

    it('V10 DB migrates to V11: fcm_devices created', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v11-test-'))
        const dbPath = join(dir, 'test.db')
        let store: Store | undefined
        try {
            const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
            db.exec('PRAGMA journal_mode = WAL')
            db.exec('PRAGMA foreign_keys = ON')
            createV10Schema(db)
            db.exec('PRAGMA user_version = 10')
            db.close()

            store = new Store(dbPath)
            expect(tableExists(store, 'fcm_devices')).toBe(true)
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('repairs a V11 DB missing fcm_devices before committing the latest version', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v11-repair-test-'))
        const dbPath = join(dir, 'test.db')
        let store: Store | undefined
        try {
            const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
            createV10Schema(db)
            db.exec('PRAGMA user_version = 11')
            db.close()

            store = new Store(dbPath)
            expect(tableExists(store, 'fcm_devices')).toBe(true)
            store.close()
            store = undefined

            const migrated = new Database(dbPath, { readonly: true, strict: true })
            try {
                expect(readUserVersion(migrated)).toBe(15)
            } finally {
                migrated.close()
            }
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('rolls back repaired tables and version when final schema validation fails', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v11-rollback-test-'))
        const dbPath = join(dir, 'test.db')
        try {
            const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
            createV10Schema(db)
            db.exec('DROP TABLE machines; PRAGMA user_version = 11')
            db.close()

            expect(() => new Store(dbPath)).toThrow('SQLite schema is missing required tables (machines)')

            const rolledBack = new Database(dbPath, { readonly: true, strict: true })
            try {
                expect(readUserVersion(rolledBack)).toBe(11)
                expect(databaseTableExists(rolledBack, 'fcm_devices')).toBe(false)
            } finally {
                rolledBack.close()
            }
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('upsert replaces token for same namespace+deviceId+platform', () => {
        const store = new Store(':memory:')
        store.fcm.upsertDevice('default', {
            token: 'tok-a',
            platform: 'phone',
            deviceId: 'pixel-1'
        })
        store.fcm.upsertDevice('default', {
            token: 'tok-b',
            platform: 'phone',
            deviceId: 'pixel-1'
        })
        const devices = store.fcm.getDevicesByNamespace('default')
        expect(devices).toHaveLength(1)
        expect(devices[0].token).toBe('tok-b')
    })
})

function tableExists(store: Store, name: string): boolean {
    const db: Database = (store as unknown as { db: Database }).db
    const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(name) as { name: string } | null
    return row !== null
}

function readUserVersion(db: Database): number {
    const row = db.prepare('PRAGMA user_version').get()
    if (!row || typeof row !== 'object' || !('user_version' in row) || typeof row.user_version !== 'number') {
        throw new Error('PRAGMA user_version did not return a numeric value')
    }
    return row.user_version
}

function databaseTableExists(db: Database, name: string): boolean {
    return db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(name) !== null
}

function createV10Schema(db: Database): void {
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
