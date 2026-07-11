import type { Database } from 'bun:sqlite'

import type { StoredMachine, VersionedUpdateResult } from './types'
import { safeJsonParse } from './json'
import { updateVersionedField } from './versionedUpdates'

type DbMachineRow = {
    id: string
    namespace: string
    created_at: number
    updated_at: number
    metadata: string | null
    metadata_version: number
    runner_state: string | null
    runner_state_version: number
    active: number
    active_at: number | null
    seq: number
    owner_account_id: number | null
}

function toStoredMachine(row: DbMachineRow): StoredMachine {
    return {
        id: row.id,
        namespace: row.namespace,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: safeJsonParse(row.metadata),
        metadataVersion: row.metadata_version,
        runnerState: safeJsonParse(row.runner_state),
        runnerStateVersion: row.runner_state_version,
        active: row.active === 1,
        activeAt: row.active_at,
        seq: row.seq,
        ownerAccountId: row.owner_account_id ?? null
    }
}

export function getOrCreateMachine(
    db: Database,
    id: string,
    metadata: unknown,
    runnerState: unknown,
    namespace: string,
    ownerAccountId?: number | null
): StoredMachine {
    const existing = db.prepare('SELECT * FROM machines WHERE id = ?').get(id) as DbMachineRow | undefined
    if (existing) {
        const stored = toStoredMachine(existing)
        if (stored.namespace !== namespace) {
            throw new Error('Machine namespace mismatch')
        }
        // Backfill ownership for machines created before multi-user, or that
        // first registered without a resolvable account. Never reassign an
        // already-owned machine.
        if (stored.ownerAccountId === null && ownerAccountId != null) {
            db.prepare('UPDATE machines SET owner_account_id = ? WHERE id = ?').run(ownerAccountId, id)
            stored.ownerAccountId = ownerAccountId
        }
        return stored
    }

    const now = Date.now()
    const metadataJson = JSON.stringify(metadata)
    const runnerStateJson = runnerState === null || runnerState === undefined ? null : JSON.stringify(runnerState)

    db.prepare(`
        INSERT INTO machines (
            id, namespace, created_at, updated_at,
            metadata, metadata_version,
            runner_state, runner_state_version,
            active, active_at, seq, owner_account_id
        ) VALUES (
            @id, @namespace, @created_at, @updated_at,
            @metadata, 1,
            @runner_state, 1,
            0, NULL, 0, @owner_account_id
        )
    `).run({
        id,
        namespace,
        created_at: now,
        updated_at: now,
        metadata: metadataJson,
        runner_state: runnerStateJson,
        owner_account_id: ownerAccountId ?? null
    })

    const row = getMachine(db, id)
    if (!row) {
        throw new Error('Failed to create machine')
    }
    return row
}

export function setMachineOwner(db: Database, id: string, ownerAccountId: number): boolean {
    const result = db.prepare(
        'UPDATE machines SET owner_account_id = ? WHERE id = ?'
    ).run(ownerAccountId, id)
    return result.changes > 0
}

/** Backfill ownership for all machines that have no owner yet. Returns count updated. */
export function backfillMachineOwners(db: Database, ownerAccountId: number): number {
    const result = db.prepare(
        'UPDATE machines SET owner_account_id = ? WHERE owner_account_id IS NULL'
    ).run(ownerAccountId)
    return result.changes
}

export function updateMachineMetadata(
    db: Database,
    id: string,
    metadata: unknown,
    expectedVersion: number,
    namespace: string
): VersionedUpdateResult<unknown | null> {
    const now = Date.now()

    return updateVersionedField({
        db,
        table: 'machines',
        id,
        namespace,
        field: 'metadata',
        versionField: 'metadata_version',
        expectedVersion,
        value: metadata,
        encode: (value) => {
            const json = JSON.stringify(value)
            return json === undefined ? null : json
        },
        decode: safeJsonParse,
        setClauses: ['updated_at = @updated_at', 'seq = seq + 1'],
        params: { updated_at: now }
    })
}

export function updateMachineRunnerState(
    db: Database,
    id: string,
    runnerState: unknown,
    expectedVersion: number,
    namespace: string
): VersionedUpdateResult<unknown | null> {
    const now = Date.now()
    const normalized = runnerState ?? null

    return updateVersionedField({
        db,
        table: 'machines',
        id,
        namespace,
        field: 'runner_state',
        versionField: 'runner_state_version',
        expectedVersion,
        value: normalized,
        encode: (value) => (value === null ? null : JSON.stringify(value)),
        decode: safeJsonParse,
        setClauses: [
            'updated_at = @updated_at',
            'active = 1',
            'active_at = @active_at',
            'seq = seq + 1'
        ],
        params: { updated_at: now, active_at: now }
    })
}

export function getMachine(db: Database, id: string): StoredMachine | null {
    const row = db.prepare('SELECT * FROM machines WHERE id = ?').get(id) as DbMachineRow | undefined
    return row ? toStoredMachine(row) : null
}

export function getMachineByNamespace(db: Database, id: string, namespace: string): StoredMachine | null {
    const row = db.prepare(
        'SELECT * FROM machines WHERE id = ? AND namespace = ?'
    ).get(id, namespace) as DbMachineRow | undefined
    return row ? toStoredMachine(row) : null
}

export function getMachines(db: Database): StoredMachine[] {
    const rows = db.prepare('SELECT * FROM machines ORDER BY updated_at DESC').all() as DbMachineRow[]
    return rows.map(toStoredMachine)
}

export function getMachinesByNamespace(db: Database, namespace: string): StoredMachine[] {
    const rows = db.prepare(
        'SELECT * FROM machines WHERE namespace = ? ORDER BY updated_at DESC'
    ).all(namespace) as DbMachineRow[]
    return rows.map(toStoredMachine)
}

/**
 * Machines visible to an account within a namespace: those it owns plus any
 * explicitly granted to it. Used for multi-user list scoping. Admins should
 * bypass this and use getMachinesByNamespace instead.
 */
export function getMachinesForAccount(
    db: Database,
    namespace: string,
    accountId: number
): StoredMachine[] {
    const rows = db.prepare(`
        SELECT DISTINCT m.* FROM machines m
        LEFT JOIN resource_grants g
            ON g.resource_type = 'machine'
            AND g.resource_id = m.id
            AND g.grantee_account_id = @accountId
        WHERE m.namespace = @namespace
          AND (m.owner_account_id = @accountId OR g.id IS NOT NULL)
        ORDER BY m.updated_at DESC
    `).all({ namespace, accountId }) as DbMachineRow[]
    return rows.map(toStoredMachine)
}
