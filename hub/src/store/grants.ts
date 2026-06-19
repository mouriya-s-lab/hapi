import type { Database } from 'bun:sqlite'

import type { GrantRole, ResourceType, StoredResourceGrant } from './types'

type DbGrantRow = {
    id: number
    resource_type: string
    resource_id: string
    grantee_account_id: number
    role: string
    created_at: number
}

function toStoredGrant(row: DbGrantRow): StoredResourceGrant {
    return {
        id: row.id,
        resourceType: row.resource_type === 'session' ? 'session' : 'machine',
        resourceId: row.resource_id,
        granteeAccountId: row.grantee_account_id,
        role: row.role === 'operator' ? 'operator' : 'viewer',
        createdAt: row.created_at
    }
}

/** The grant (if any) a specific account holds on a specific resource. */
export function getGrant(
    db: Database,
    resourceType: ResourceType,
    resourceId: string,
    granteeAccountId: number
): StoredResourceGrant | null {
    const row = db.prepare(`
        SELECT * FROM resource_grants
        WHERE resource_type = ? AND resource_id = ? AND grantee_account_id = ?
        LIMIT 1
    `).get(resourceType, resourceId, granteeAccountId) as DbGrantRow | undefined
    return row ? toStoredGrant(row) : null
}

/** All grants on a resource (for showing "shared with" lists). */
export function listGrantsForResource(
    db: Database,
    resourceType: ResourceType,
    resourceId: string
): StoredResourceGrant[] {
    const rows = db.prepare(`
        SELECT * FROM resource_grants
        WHERE resource_type = ? AND resource_id = ?
        ORDER BY created_at ASC
    `).all(resourceType, resourceId) as DbGrantRow[]
    return rows.map(toStoredGrant)
}

/** All resource ids of a type that an account has been granted access to. */
export function listGrantedResourceIds(
    db: Database,
    resourceType: ResourceType,
    granteeAccountId: number
): string[] {
    const rows = db.prepare(`
        SELECT resource_id FROM resource_grants
        WHERE resource_type = ? AND grantee_account_id = ?
    `).all(resourceType, granteeAccountId) as Array<{ resource_id: string }>
    return rows.map((r) => r.resource_id)
}

export function upsertGrant(
    db: Database,
    params: {
        resourceType: ResourceType
        resourceId: string
        granteeAccountId: number
        role: GrantRole
    }
): StoredResourceGrant {
    const now = Date.now()
    db.prepare(`
        INSERT INTO resource_grants (
            resource_type, resource_id, grantee_account_id, role, created_at
        ) VALUES (
            @resource_type, @resource_id, @grantee_account_id, @role, @created_at
        )
        ON CONFLICT(resource_type, resource_id, grantee_account_id)
        DO UPDATE SET role = @role
    `).run({
        resource_type: params.resourceType,
        resource_id: params.resourceId,
        grantee_account_id: params.granteeAccountId,
        role: params.role,
        created_at: now
    })

    const grant = getGrant(db, params.resourceType, params.resourceId, params.granteeAccountId)
    if (!grant) {
        throw new Error('Failed to upsert resource grant')
    }
    return grant
}

export function removeGrant(
    db: Database,
    resourceType: ResourceType,
    resourceId: string,
    granteeAccountId: number
): boolean {
    const result = db.prepare(`
        DELETE FROM resource_grants
        WHERE resource_type = ? AND resource_id = ? AND grantee_account_id = ?
    `).run(resourceType, resourceId, granteeAccountId)
    return result.changes > 0
}
