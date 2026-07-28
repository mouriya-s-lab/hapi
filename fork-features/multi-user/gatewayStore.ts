import { Database } from 'bun:sqlite'
import type { Account, AccountRole, ApiToken, GrantRole, ResourceBinding, ResourceType } from './domain'

type AccountRow = { id: number; username: string; password_hash: string | null; role: string; default_namespace: string; disabled_at: number | null; memory: string | null }
type BindingRow = { resource_type: string; resource_id: string; owner_account_id: number; core_namespace: string }
type TokenRow = { id: number; account_id: number; name: string | null; token_hash: string; created_at: number; revoked_at: number | null }

const toAccount = (row: AccountRow): Account => ({
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role === 'admin' ? 'admin' : 'user',
    defaultNamespace: row.default_namespace,
    disabledAt: row.disabled_at,
    memory: row.memory ?? null
})

const toBinding = (row: BindingRow): ResourceBinding => ({
    resourceType: row.resource_type === 'machine' ? 'machine' : 'session',
    resourceId: row.resource_id,
    ownerAccountId: row.owner_account_id,
    coreNamespace: row.core_namespace
})

const toToken = (row: TokenRow): ApiToken => ({
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    revokedAt: row.revoked_at
})

export class MultiUserGatewayStore {
    private readonly db: Database

    constructor(path: string) {
        this.db = new Database(path, { create: true })
        this.db.exec('PRAGMA foreign_keys = ON')
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS gateway_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT,
                role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
                default_namespace TEXT NOT NULL,
                disabled_at INTEGER,
                memory TEXT
            );
            CREATE TABLE IF NOT EXISTS gateway_resources (
                resource_type TEXT NOT NULL CHECK(resource_type IN ('session', 'machine')),
                resource_id TEXT NOT NULL,
                owner_account_id INTEGER NOT NULL REFERENCES gateway_accounts(id),
                core_namespace TEXT NOT NULL,
                PRIMARY KEY(resource_type, resource_id)
            );
            CREATE TABLE IF NOT EXISTS gateway_api_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL REFERENCES gateway_accounts(id) ON DELETE CASCADE,
                name TEXT,
                token_hash TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL,
                revoked_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS gateway_grants (
                resource_type TEXT NOT NULL,
                resource_id TEXT NOT NULL,
                grantee_account_id INTEGER NOT NULL REFERENCES gateway_accounts(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('viewer', 'operator')),
                PRIMARY KEY(resource_type, resource_id, grantee_account_id),
                FOREIGN KEY(resource_type, resource_id) REFERENCES gateway_resources(resource_type, resource_id) ON DELETE CASCADE
            );
        `)
        const accountColumns = this.db.prepare('PRAGMA table_info(gateway_accounts)').all() as Array<{ name: string }>
        if (!accountColumns.some(column => column.name === 'memory')) this.db.exec('ALTER TABLE gateway_accounts ADD COLUMN memory TEXT')
    }

    close(): void { this.db.close() }

    countAccounts(): number {
        return (this.db.prepare('SELECT COUNT(*) AS count FROM gateway_accounts').get() as { count: number }).count
    }

    createAccount(username: string, role: AccountRole, defaultNamespace: string, passwordHash: string | null = null): Account {
        const result = this.db.prepare('INSERT INTO gateway_accounts(username,password_hash,role,default_namespace) VALUES(?,?,?,?)')
            .run(username, passwordHash, role, defaultNamespace)
        return this.getAccount(Number(result.lastInsertRowid))!
    }

    getAccount(id: number): Account | null {
        const row = this.db.prepare('SELECT * FROM gateway_accounts WHERE id = ?').get(id) as AccountRow | undefined
        return row ? toAccount(row) : null
    }

    getAccountByUsername(username: string): Account | null {
        const row = this.db.prepare('SELECT * FROM gateway_accounts WHERE username = ?').get(username) as AccountRow | undefined
        return row ? toAccount(row) : null
    }

    listAccounts(): Account[] {
        return (this.db.prepare('SELECT * FROM gateway_accounts ORDER BY id').all() as AccountRow[]).map(toAccount)
    }

    updateAccount(id: number, input: { role?: AccountRole; passwordHash?: string; disabled?: boolean; memory?: string | null }): Account | null {
        this.db.transaction(() => {
            if (input.role) this.db.prepare('UPDATE gateway_accounts SET role=? WHERE id=?').run(input.role, id)
            if (input.passwordHash) this.db.prepare('UPDATE gateway_accounts SET password_hash=? WHERE id=?').run(input.passwordHash, id)
            if (input.disabled !== undefined) this.db.prepare('UPDATE gateway_accounts SET disabled_at=? WHERE id=?').run(input.disabled ? Date.now() : null, id)
            if (input.memory !== undefined) this.db.prepare('UPDATE gateway_accounts SET memory=? WHERE id=?').run(input.memory?.trim() || null, id)
        })()
        return this.getAccount(id)
    }

    deleteAccount(id: number): boolean {
        return this.db.prepare('DELETE FROM gateway_accounts WHERE id=?').run(id).changes > 0
    }

    createToken(accountId: number, name: string | null, tokenHash: string): ApiToken {
        const result = this.db.prepare('INSERT INTO gateway_api_tokens(account_id,name,token_hash,created_at) VALUES(?,?,?,?)')
            .run(accountId, name, tokenHash, Date.now())
        return this.getToken(Number(result.lastInsertRowid))!
    }

    getToken(id: number): ApiToken | null {
        const row = this.db.prepare('SELECT * FROM gateway_api_tokens WHERE id=?').get(id) as TokenRow | undefined
        return row ? toToken(row) : null
    }

    getActiveTokenByHash(hash: string): ApiToken | null {
        const row = this.db.prepare('SELECT * FROM gateway_api_tokens WHERE token_hash=? AND revoked_at IS NULL').get(hash) as TokenRow | undefined
        return row ? toToken(row) : null
    }

    listTokens(accountId: number): ApiToken[] {
        return (this.db.prepare('SELECT * FROM gateway_api_tokens WHERE account_id=? AND revoked_at IS NULL ORDER BY id DESC').all(accountId) as TokenRow[]).map(toToken)
    }

    revokeToken(id: number, accountId: number): boolean {
        return this.db.prepare('UPDATE gateway_api_tokens SET revoked_at=? WHERE id=? AND account_id=? AND revoked_at IS NULL')
            .run(Date.now(), id, accountId).changes > 0
    }

    bindResource(binding: ResourceBinding): void {
        this.db.prepare(`INSERT INTO gateway_resources(resource_type,resource_id,owner_account_id,core_namespace)
            VALUES(?,?,?,?) ON CONFLICT(resource_type,resource_id) DO UPDATE SET
            owner_account_id=excluded.owner_account_id, core_namespace=excluded.core_namespace`)
            .run(binding.resourceType, binding.resourceId, binding.ownerAccountId, binding.coreNamespace)
    }

    getResource(type: ResourceType, id: string): ResourceBinding | null {
        const row = this.db.prepare('SELECT * FROM gateway_resources WHERE resource_type=? AND resource_id=?').get(type, id) as BindingRow | undefined
        return row ? toBinding(row) : null
    }

    listAccessibleResources(type: ResourceType, accountId: number): ResourceBinding[] {
        const rows = this.db.prepare(`
            SELECT DISTINCT r.* FROM gateway_resources r
            LEFT JOIN gateway_grants g ON g.resource_type=r.resource_type AND g.resource_id=r.resource_id
            WHERE r.resource_type=? AND (r.owner_account_id=? OR g.grantee_account_id=?)
            ORDER BY r.resource_id
        `).all(type, accountId, accountId) as BindingRow[]
        return rows.map(toBinding)
    }

    listAudienceAccountIds(type: ResourceType, id: string, capability: 'read' | 'operate'): number[] {
        const resource = this.getResource(type, id)
        if (!resource) return []
        const grants = this.listGrants(type, id)
            .filter(grant => capability === 'read' || grant.role === 'operator')
            .map(grant => grant.accountId)
        return Array.from(new Set([resource.ownerAccountId, ...grants]))
    }

    grant(type: ResourceType, id: string, accountId: number, role: GrantRole): void {
        this.db.prepare(`INSERT INTO gateway_grants(resource_type,resource_id,grantee_account_id,role) VALUES(?,?,?,?)
            ON CONFLICT(resource_type,resource_id,grantee_account_id) DO UPDATE SET role=excluded.role`)
            .run(type, id, accountId, role)
    }

    getGrant(type: ResourceType, id: string, accountId: number): GrantRole | null {
        const row = this.db.prepare('SELECT role FROM gateway_grants WHERE resource_type=? AND resource_id=? AND grantee_account_id=?')
            .get(type, id, accountId) as { role: GrantRole } | undefined
        return row?.role ?? null
    }

    listGrants(type: ResourceType, id: string): Array<{ accountId: number; role: GrantRole }> {
        return this.db.prepare('SELECT grantee_account_id AS accountId, role FROM gateway_grants WHERE resource_type=? AND resource_id=? ORDER BY grantee_account_id')
            .all(type, id) as Array<{ accountId: number; role: GrantRole }>
    }

    removeGrant(type: ResourceType, id: string, accountId: number): boolean {
        return this.db.prepare('DELETE FROM gateway_grants WHERE resource_type=? AND resource_id=? AND grantee_account_id=?')
            .run(type, id, accountId).changes > 0
    }
}
