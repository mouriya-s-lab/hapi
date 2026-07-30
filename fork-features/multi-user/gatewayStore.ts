import { Database } from 'bun:sqlite'
import type {
    Account,
    AccountRole,
    ApiToken,
    ExternalIdentityBinding,
    GrantRole,
    PushSubscriptionAccountBinding,
    ResourceBinding,
    ResourceType
} from './domain'

type AccountRow = {
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
type BindingRow = { resource_type: string; resource_id: string; owner_account_id: number; core_namespace: string }
type TokenRow = {
    id: number
    account_id: number
    name: string | null
    token_hash: string
    namespace: string
    created_at: number
    last_used_at: number | null
    revoked_at: number | null
}

function toAccount(row: AccountRow): Account {
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

function toBinding(row: BindingRow): ResourceBinding {
    return {
        resourceType: row.resource_type === 'machine' ? 'machine' : 'session',
        resourceId: row.resource_id,
        ownerAccountId: row.owner_account_id,
        coreNamespace: row.core_namespace
    }
}

function toToken(row: TokenRow): ApiToken {
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

function columnNames(db: Database, table: string): Set<string> {
    return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(row => row.name))
}

export function applyGatewaySchema(db: Database): void {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(`
        CREATE TABLE IF NOT EXISTS gateway_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT,
            auth_provider TEXT NOT NULL DEFAULT 'local',
            role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
            default_namespace TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT 0,
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
            namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            last_used_at INTEGER,
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
        CREATE TABLE IF NOT EXISTS gateway_external_identities (
            platform TEXT NOT NULL,
            platform_user_id TEXT NOT NULL,
            account_id INTEGER NOT NULL REFERENCES gateway_accounts(id) ON DELETE CASCADE,
            PRIMARY KEY(platform, platform_user_id)
        );
        CREATE TABLE IF NOT EXISTS gateway_push_subscription_accounts (
            namespace TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            account_id INTEGER NOT NULL REFERENCES gateway_accounts(id) ON DELETE CASCADE,
            PRIMARY KEY(namespace, endpoint)
        );
    `)
    const accountColumns = columnNames(db, 'gateway_accounts')
    if (!accountColumns.has('memory')) db.exec('ALTER TABLE gateway_accounts ADD COLUMN memory TEXT')
    if (!accountColumns.has('auth_provider')) {
        db.exec("ALTER TABLE gateway_accounts ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'")
    }
    if (!accountColumns.has('created_at')) {
        db.exec('ALTER TABLE gateway_accounts ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0')
    }

    const tokenColumns = columnNames(db, 'gateway_api_tokens')
    if (!tokenColumns.has('namespace')) {
        db.transaction(() => {
            db.exec("ALTER TABLE gateway_api_tokens ADD COLUMN namespace TEXT NOT NULL DEFAULT 'default'")
            db.exec(`
                UPDATE gateway_api_tokens
                SET namespace = (
                    SELECT default_namespace FROM gateway_accounts
                    WHERE gateway_accounts.id = gateway_api_tokens.account_id
                )
            `)
        })()
    }
    if (!tokenColumns.has('last_used_at')) db.exec('ALTER TABLE gateway_api_tokens ADD COLUMN last_used_at INTEGER')
}

export class MultiUserGatewayStore {
    private readonly db: Database

    constructor(path: string) {
        this.db = new Database(path, { create: true })
        applyGatewaySchema(this.db)
    }

    close(): void { this.db.close() }

    countAccounts(): number {
        return (this.db.prepare('SELECT COUNT(*) AS count FROM gateway_accounts').get() as { count: number }).count
    }

    createAccount(username: string, role: AccountRole, defaultNamespace: string, passwordHash: string | null = null): Account {
        const result = this.db.prepare(
            'INSERT INTO gateway_accounts(username,password_hash,role,default_namespace,created_at) VALUES(?,?,?,?,?)'
        ).run(username, passwordHash, role, defaultNamespace, Date.now())
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

    resolveUniqueActiveAccountByNamespace(namespace: string): Account | null {
        const rows = this.db.prepare(`
            SELECT DISTINCT a.* FROM gateway_accounts a
            LEFT JOIN gateway_api_tokens t
                ON t.account_id=a.id AND t.revoked_at IS NULL
            WHERE a.disabled_at IS NULL
                AND (a.default_namespace=? OR t.namespace=?)
            LIMIT 2
        `).all(namespace, namespace) as AccountRow[]
        return rows.length === 1 ? toAccount(rows[0]) : null
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

    createToken(accountId: number, name: string | null, tokenHash: string, namespace?: string): ApiToken {
        const account = this.getAccount(accountId)
        if (!account) throw new Error(`Account ${accountId} not found`)
        const result = this.db.prepare(
            'INSERT INTO gateway_api_tokens(account_id,name,token_hash,namespace,created_at) VALUES(?,?,?,?,?)'
        ).run(accountId, name, tokenHash, namespace ?? account.defaultNamespace, Date.now())
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

    touchTokenLastUsed(id: number, when: number = Date.now()): void {
        this.db.prepare('UPDATE gateway_api_tokens SET last_used_at=? WHERE id=?').run(when, id)
    }

    revokeToken(id: number, accountId: number): boolean {
        return this.db.prepare('UPDATE gateway_api_tokens SET revoked_at=? WHERE id=? AND account_id=? AND revoked_at IS NULL')
            .run(Date.now(), id, accountId).changes > 0
    }

    bindExternalIdentity(binding: ExternalIdentityBinding): void {
        this.db.prepare(`
            INSERT INTO gateway_external_identities(platform,platform_user_id,account_id)
            VALUES(?,?,?)
            ON CONFLICT(platform,platform_user_id) DO UPDATE SET account_id=excluded.account_id
        `).run(binding.platform, binding.platformUserId, binding.accountId)
    }

    getExternalIdentity(platform: string, platformUserId: string): ExternalIdentityBinding | null {
        const binding = this.db.prepare(`
            SELECT platform, platform_user_id AS platformUserId, account_id AS accountId
            FROM gateway_external_identities
            WHERE platform=? AND platform_user_id=?
        `).get(platform, platformUserId) as ExternalIdentityBinding | undefined
        return binding ?? null
    }

    listExternalIdentities(accountId: number, platform: string): ExternalIdentityBinding[] {
        return this.db.prepare(`
            SELECT platform, platform_user_id AS platformUserId, account_id AS accountId
            FROM gateway_external_identities
            WHERE account_id=? AND platform=?
            ORDER BY platform_user_id
        `).all(accountId, platform) as ExternalIdentityBinding[]
    }

    bindPushSubscriptionAccount(binding: PushSubscriptionAccountBinding): void {
        this.db.prepare(`
            INSERT INTO gateway_push_subscription_accounts(namespace,endpoint,account_id)
            VALUES(?,?,?)
            ON CONFLICT(namespace,endpoint) DO UPDATE SET account_id=excluded.account_id
        `).run(binding.namespace, binding.endpoint, binding.accountId)
    }

    getPushSubscriptionAccount(namespace: string, endpoint: string): PushSubscriptionAccountBinding | null {
        const binding = this.db.prepare(`
            SELECT namespace, endpoint, account_id AS accountId
            FROM gateway_push_subscription_accounts
            WHERE namespace=? AND endpoint=?
        `).get(namespace, endpoint) as PushSubscriptionAccountBinding | undefined
        return binding ?? null
    }

    listPushSubscriptionAccounts(namespace: string): PushSubscriptionAccountBinding[] {
        return this.db.prepare(`
            SELECT namespace, endpoint, account_id AS accountId
            FROM gateway_push_subscription_accounts
            WHERE namespace=?
            ORDER BY endpoint
        `).all(namespace) as PushSubscriptionAccountBinding[]
    }

    listPushSubscriptionNamespaces(accountId: number): string[] {
        return (this.db.prepare(`
            SELECT DISTINCT namespace
            FROM gateway_push_subscription_accounts
            WHERE account_id=?
            ORDER BY namespace
        `).all(accountId) as Array<{ namespace: string }>).map(row => row.namespace)
    }

    removePushSubscriptionAccount(namespace: string, endpoint: string): void {
        this.db.prepare(`
            DELETE FROM gateway_push_subscription_accounts
            WHERE namespace=? AND endpoint=?
        `).run(namespace, endpoint)
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
        const account = this.getAccount(accountId)
        if (!account || account.disabledAt !== null) return []
        if (account.role === 'admin') {
            return (this.db.prepare(
                'SELECT * FROM gateway_resources WHERE resource_type=? ORDER BY resource_id'
            ).all(type) as BindingRow[]).map(toBinding)
        }
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
        const admins = this.db.prepare(`
            SELECT id FROM gateway_accounts
            WHERE role='admin' AND disabled_at IS NULL
        `).all() as Array<{ id: number }>
        const grants = this.listGrants(type, id)
            .filter(grant => capability === 'read' || grant.role === 'operator')
            .map(grant => grant.accountId)
        return Array.from(new Set([
            resource.ownerAccountId,
            ...admins.map(account => account.id),
            ...grants
        ]))
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
