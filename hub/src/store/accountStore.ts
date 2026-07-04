import type { Database } from 'bun:sqlite'

import type { AccountRole, StoredAccount } from './types'
import {
    countAccounts,
    createAccount,
    deleteAccount,
    getAccountById,
    getAccountByUsername,
    listAccounts,
    setAccountDefaultNamespace,
    setAccountDisabled,
    setAccountMemory,
    setAccountPassword,
    setAccountRole
} from './accounts'

export class AccountStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getById(id: number): StoredAccount | null {
        return getAccountById(this.db, id)
    }

    getByUsername(username: string): StoredAccount | null {
        return getAccountByUsername(this.db, username)
    }

    list(): StoredAccount[] {
        return listAccounts(this.db)
    }

    count(): number {
        return countAccounts(this.db)
    }

    create(params: {
        username: string
        passwordHash: string | null
        role: AccountRole
        defaultNamespace: string
        authProvider?: string
    }): StoredAccount {
        return createAccount(this.db, params)
    }

    setPassword(id: number, passwordHash: string): boolean {
        return setAccountPassword(this.db, id, passwordHash)
    }

    setRole(id: number, role: AccountRole): boolean {
        return setAccountRole(this.db, id, role)
    }

    setDefaultNamespace(id: number, namespace: string): boolean {
        return setAccountDefaultNamespace(this.db, id, namespace)
    }

    setMemory(id: number, memory: string | null): boolean {
        return setAccountMemory(this.db, id, memory)
    }

    setDisabled(id: number, disabled: boolean): boolean {
        return setAccountDisabled(this.db, id, disabled)
    }

    delete(id: number): boolean {
        return deleteAccount(this.db, id)
    }
}
