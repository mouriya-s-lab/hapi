import type { Database } from 'bun:sqlite'

import type { StoredMachine, VersionedUpdateResult } from './types'
import {
    backfillMachineOwners,
    getMachine,
    getMachineByNamespace,
    getMachines,
    getMachinesByNamespace,
    getMachinesForAccount,
    getOrCreateMachine,
    setMachineOwner,
    updateMachineRunnerState,
    updateMachineMetadata
} from './machines'

export class MachineStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getOrCreateMachine(
        id: string,
        metadata: unknown,
        runnerState: unknown,
        namespace: string,
        ownerAccountId?: number | null
    ): StoredMachine {
        return getOrCreateMachine(this.db, id, metadata, runnerState, namespace, ownerAccountId)
    }

    updateMachineMetadata(
        id: string,
        metadata: unknown,
        expectedVersion: number,
        namespace: string
    ): VersionedUpdateResult<unknown | null> {
        return updateMachineMetadata(this.db, id, metadata, expectedVersion, namespace)
    }

    updateMachineRunnerState(
        id: string,
        runnerState: unknown,
        expectedVersion: number,
        namespace: string
    ): VersionedUpdateResult<unknown | null> {
        return updateMachineRunnerState(this.db, id, runnerState, expectedVersion, namespace)
    }

    getMachine(id: string): StoredMachine | null {
        return getMachine(this.db, id)
    }

    getMachineByNamespace(id: string, namespace: string): StoredMachine | null {
        return getMachineByNamespace(this.db, id, namespace)
    }

    getMachines(): StoredMachine[] {
        return getMachines(this.db)
    }

    getMachinesByNamespace(namespace: string): StoredMachine[] {
        return getMachinesByNamespace(this.db, namespace)
    }

    getMachinesForAccount(namespace: string, accountId: number): StoredMachine[] {
        return getMachinesForAccount(this.db, namespace, accountId)
    }

    setMachineOwner(id: string, ownerAccountId: number): boolean {
        return setMachineOwner(this.db, id, ownerAccountId)
    }

    backfillMachineOwners(ownerAccountId: number): number {
        return backfillMachineOwners(this.db, ownerAccountId)
    }
}
