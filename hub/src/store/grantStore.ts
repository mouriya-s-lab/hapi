import type { Database } from 'bun:sqlite'

import type { GrantRole, ResourceType, StoredResourceGrant } from './types'
import {
    getGrant,
    listGrantedResourceIds,
    listGrantsForResource,
    removeGrant,
    upsertGrant
} from './grants'

export class GrantStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    get(resourceType: ResourceType, resourceId: string, granteeAccountId: number): StoredResourceGrant | null {
        return getGrant(this.db, resourceType, resourceId, granteeAccountId)
    }

    listForResource(resourceType: ResourceType, resourceId: string): StoredResourceGrant[] {
        return listGrantsForResource(this.db, resourceType, resourceId)
    }

    listGrantedResourceIds(resourceType: ResourceType, granteeAccountId: number): string[] {
        return listGrantedResourceIds(this.db, resourceType, granteeAccountId)
    }

    upsert(params: {
        resourceType: ResourceType
        resourceId: string
        granteeAccountId: number
        role: GrantRole
    }): StoredResourceGrant {
        return upsertGrant(this.db, params)
    }

    remove(resourceType: ResourceType, resourceId: string, granteeAccountId: number): boolean {
        return removeGrant(this.db, resourceType, resourceId, granteeAccountId)
    }
}
