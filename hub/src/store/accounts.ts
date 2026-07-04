import type { Database } from 'bun:sqlite'

import type { AccountRole, StoredAccount } from './types'

type DbAccountRow = {
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

function toStoredAccount(row: DbAccountRow): StoredAccount {
    return {
        id: row.id,
        username: row.username,
        passwordHash: row.password_hash,
        authProvider: row.auth_provider,
        role: row.role === 'admin' ? 'admin' : 'user',
        defaultNamespace: row.default_namespace,
        createdAt: row.created_at,
        disabledAt: row.disabled_at,
        memory: row.memory ?? null
    }
}

export function getAccountById(db: Database, id: number): StoredAccount | null {
    const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as DbAccountRow | undefined
    return row ? toStoredAccount(row) : null
}

export function getAccountByUsername(db: Database, username: string): StoredAccount | null {
    const row = db.prepare(
        'SELECT * FROM accounts WHERE username = ? LIMIT 1'
    ).get(username) as DbAccountRow | undefined
    return row ? toStoredAccount(row) : null
}

export function listAccounts(db: Database): StoredAccount[] {
    const rows = db.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all() as DbAccountRow[]
    return rows.map(toStoredAccount)
}

export function countAccounts(db: Database): number {
    const row = db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }
    return row.n
}

export function createAccount(
    db: Database,
    params: {
        username: string
        passwordHash: string | null
        role: AccountRole
        defaultNamespace: string
        authProvider?: string
    }
): StoredAccount {
    const now = Date.now()
    const info = db.prepare(`
        INSERT INTO accounts (
            username, password_hash, auth_provider, role, default_namespace, created_at, disabled_at
        ) VALUES (
            @username, @password_hash, @auth_provider, @role, @default_namespace, @created_at, NULL
        )
    `).run({
        username: params.username,
        password_hash: params.passwordHash,
        auth_provider: params.authProvider ?? 'local',
        role: params.role,
        default_namespace: params.defaultNamespace,
        created_at: now
    })

    const account = getAccountById(db, Number(info.lastInsertRowid))
    if (!account) {
        throw new Error('Failed to create account')
    }
    return account
}

export function setAccountPassword(db: Database, id: number, passwordHash: string): boolean {
    const result = db.prepare(
        'UPDATE accounts SET password_hash = ? WHERE id = ?'
    ).run(passwordHash, id)
    return result.changes > 0
}

export function setAccountRole(db: Database, id: number, role: AccountRole): boolean {
    const result = db.prepare('UPDATE accounts SET role = ? WHERE id = ?').run(role, id)
    return result.changes > 0
}

export function setAccountDefaultNamespace(db: Database, id: number, namespace: string): boolean {
    const result = db.prepare('UPDATE accounts SET default_namespace = ? WHERE id = ?').run(namespace, id)
    return result.changes > 0
}

export function setAccountMemory(db: Database, id: number, memory: string | null): boolean {
    const normalized = memory !== null && memory.trim().length > 0 ? memory : null
    const result = db.prepare('UPDATE accounts SET memory = ? WHERE id = ?').run(normalized, id)
    return result.changes > 0
}

export function setAccountDisabled(db: Database, id: number, disabled: boolean): boolean {
    const result = db.prepare(
        'UPDATE accounts SET disabled_at = ? WHERE id = ?'
    ).run(disabled ? Date.now() : null, id)
    return result.changes > 0
}

export function deleteAccount(db: Database, id: number): boolean {
    const result = db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
    return result.changes > 0
}
