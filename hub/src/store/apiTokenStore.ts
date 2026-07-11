import type { Database } from 'bun:sqlite'

import type { StoredApiToken } from './types'
import {
    createApiToken,
    getActiveTokenByHash,
    getTokenById,
    listTokensForAccount,
    revokeToken,
    touchTokenLastUsed
} from './apiTokens'

export class ApiTokenStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getActiveByHash(tokenHash: string): StoredApiToken | null {
        return getActiveTokenByHash(this.db, tokenHash)
    }

    getById(id: number): StoredApiToken | null {
        return getTokenById(this.db, id)
    }

    listForAccount(accountId: number): StoredApiToken[] {
        return listTokensForAccount(this.db, accountId)
    }

    create(params: { accountId: number; name: string | null; tokenHash: string; namespace: string }): StoredApiToken {
        return createApiToken(this.db, params)
    }

    touchLastUsed(id: number, when?: number): void {
        touchTokenLastUsed(this.db, id, when)
    }

    revoke(id: number, accountId: number): boolean {
        return revokeToken(this.db, id, accountId)
    }
}
