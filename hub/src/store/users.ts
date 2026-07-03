import type { Database } from 'bun:sqlite'

import type { StoredUser } from './types'

type DbUserRow = {
    id: number
    platform: string
    platform_user_id: string
    namespace: string
    created_at: number
    account_id: number | null
}

function toStoredUser(row: DbUserRow): StoredUser {
    return {
        id: row.id,
        platform: row.platform,
        platformUserId: row.platform_user_id,
        namespace: row.namespace,
        createdAt: row.created_at,
        accountId: row.account_id ?? null
    }
}

export function getUser(db: Database, platform: string, platformUserId: string): StoredUser | null {
    const row = db.prepare(
        'SELECT * FROM users WHERE platform = ? AND platform_user_id = ? LIMIT 1'
    ).get(platform, platformUserId) as DbUserRow | undefined
    return row ? toStoredUser(row) : null
}

export function getUsersByPlatform(db: Database, platform: string): StoredUser[] {
    const rows = db.prepare(
        'SELECT * FROM users WHERE platform = ? ORDER BY created_at ASC'
    ).all(platform) as DbUserRow[]
    return rows.map(toStoredUser)
}

export function getUsersByPlatformAndNamespace(
    db: Database,
    platform: string,
    namespace: string
): StoredUser[] {
    const rows = db.prepare(
        'SELECT * FROM users WHERE platform = ? AND namespace = ? ORDER BY created_at ASC'
    ).all(platform, namespace) as DbUserRow[]
    return rows.map(toStoredUser)
}

export function addUser(
    db: Database,
    platform: string,
    platformUserId: string,
    namespace: string,
    accountId?: number | null
): StoredUser {
    const now = Date.now()
    db.prepare(`
        INSERT OR IGNORE INTO users (
            platform, platform_user_id, namespace, created_at, account_id
        ) VALUES (
            @platform, @platform_user_id, @namespace, @created_at, @account_id
        )
    `).run({
        platform,
        platform_user_id: platformUserId,
        namespace,
        created_at: now,
        account_id: accountId ?? null
    })

    // Re-binding with a different token: keep the row but move it to the new
    // account/namespace so a stale binding can't keep an old identity alive.
    const row = getUser(db, platform, platformUserId)
    if (!row) {
        throw new Error('Failed to create user')
    }
    if (accountId != null && (row.accountId !== accountId || row.namespace !== namespace)) {
        db.prepare(
            'UPDATE users SET account_id = ?, namespace = ? WHERE platform = ? AND platform_user_id = ?'
        ).run(accountId, namespace, platform, platformUserId)
        return getUser(db, platform, platformUserId) ?? row
    }
    return row
}

export function removeUser(db: Database, platform: string, platformUserId: string): boolean {
    const result = db.prepare(
        'DELETE FROM users WHERE platform = ? AND platform_user_id = ?'
    ).run(platform, platformUserId)
    return result.changes > 0
}
