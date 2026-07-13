import type { Database } from 'bun:sqlite'

export class IdentityStore {
    constructor(private readonly db: Database) {}

    getSetting(key: string): string | null {
        const row = this.db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | undefined
        return row?.value ?? null
    }

    setSetting(key: string, value: string): void {
        this.db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value)
    }

    addNamespaceMembership(namespace: string, accountId: number, role: 'member' | 'admin' = 'member'): void {
        this.db.prepare('INSERT OR IGNORE INTO namespaces (name) VALUES (?)').run(namespace)
        this.db.prepare(`INSERT INTO namespace_memberships (namespace, account_id, role) VALUES (?, ?, ?)
            ON CONFLICT(namespace, account_id) DO UPDATE SET role = excluded.role`).run(namespace, accountId, role)
    }

    hasNamespaceMembership(namespace: string, accountId: number): boolean {
        return Boolean(this.db.prepare(
            'SELECT 1 FROM namespace_memberships WHERE namespace = ? AND account_id = ?'
        ).get(namespace, accountId))
    }

    bindSessionRuntime(sessionId: string, accountId: number, machineId: string): void {
        this.db.prepare(`INSERT INTO session_runtime_bindings (session_id, account_id, machine_id) VALUES (?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET account_id = excluded.account_id, machine_id = excluded.machine_id`
        ).run(sessionId, accountId, machineId)
    }

    isSessionRuntimeAccount(sessionId: string, accountId: number): boolean {
        return Boolean(this.db.prepare(
            'SELECT 1 FROM session_runtime_bindings WHERE session_id = ? AND account_id = ?'
        ).get(sessionId, accountId))
    }

    moveSessionRuntimeBinding(fromSessionId: string, toSessionId: string): void {
        const binding = this.db.prepare(
            'SELECT account_id, machine_id FROM session_runtime_bindings WHERE session_id = ?'
        ).get(fromSessionId) as { account_id: number; machine_id: string } | undefined
        if (!binding) return
        const target = this.db.prepare('SELECT 1 FROM session_runtime_bindings WHERE session_id = ?').get(toSessionId)
        if (!target) this.bindSessionRuntime(toSessionId, binding.account_id, binding.machine_id)
        this.db.prepare('DELETE FROM session_runtime_bindings WHERE session_id = ?').run(fromSessionId)
    }

    accountOwnsResources(accountId: number): boolean {
        const row = this.db.prepare(`SELECT
            EXISTS(SELECT 1 FROM sessions WHERE owner_account_id = ?) OR
            EXISTS(SELECT 1 FROM machines WHERE owner_account_id = ?) OR
            EXISTS(SELECT 1 FROM session_runtime_bindings WHERE account_id = ?) AS owns`
        ).get(accountId, accountId, accountId) as { owns: number }
        return row.owns === 1
    }
}
