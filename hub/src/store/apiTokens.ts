import type { Database } from 'bun:sqlite'

import type { StoredApiToken } from './types'

type DbApiTokenRow = {
    id: number
    account_id: number
    name: string | null
    token_hash: string
    namespace: string
    created_at: number
    last_used_at: number | null
    revoked_at: number | null
}

function toStoredApiToken(row: DbApiTokenRow): StoredApiToken {
    return {
        id: row.id,
        accountId: row.account_id,
        name: row.name,
        tokenHash: row.token_hash,
        namespace: row.namespace,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at
    }
}

/** Look up an active (non-revoked) token by its at-rest hash. */
export function getActiveTokenByHash(db: Database, tokenHash: string): StoredApiToken | null {
    const row = db.prepare(
        'SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1'
    ).get(tokenHash) as DbApiTokenRow | undefined
    return row ? toStoredApiToken(row) : null
}

export function getTokenById(db: Database, id: number): StoredApiToken | null {
    const row = db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(id) as DbApiTokenRow | undefined
    return row ? toStoredApiToken(row) : null
}

export function listTokensForAccount(db: Database, accountId: number): StoredApiToken[] {
    const rows = db.prepare(
        'SELECT * FROM api_tokens WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at DESC'
    ).all(accountId) as DbApiTokenRow[]
    return rows.map(toStoredApiToken)
}

export function createApiToken(
    db: Database,
    params: { accountId: number; name: string | null; tokenHash: string; namespace: string }
): StoredApiToken {
    const now = Date.now()
    const info = db.prepare(`
        INSERT INTO api_tokens (
            account_id, name, token_hash, namespace, created_at, last_used_at, revoked_at
        ) VALUES (
            @account_id, @name, @token_hash, @namespace, @created_at, NULL, NULL
        )
    `).run({
        account_id: params.accountId,
        name: params.name,
        token_hash: params.tokenHash,
        namespace: params.namespace,
        created_at: now
    })

    const token = getTokenById(db, Number(info.lastInsertRowid))
    if (!token) {
        throw new Error('Failed to create API token')
    }
    return token
}

export function touchTokenLastUsed(db: Database, id: number, when: number = Date.now()): void {
    db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(when, id)
}

/** Revoke a token. Scoped to accountId so callers can't revoke others' tokens. */
export function revokeToken(db: Database, id: number, accountId: number): boolean {
    const result = db.prepare(
        'UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL'
    ).run(Date.now(), id, accountId)
    return result.changes > 0
}
