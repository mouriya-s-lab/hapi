import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

const tempDirs: string[] = []

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('schema migration v21 to v22', () => {
    it('adds pinned and global_pinned columns with unpinned defaults', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v22-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        new Store(dbPath).close()
        const legacy = new Database(dbPath)
        legacy.exec('ALTER TABLE sessions DROP COLUMN pinned')
        legacy.exec('ALTER TABLE sessions DROP COLUMN global_pinned')
        legacy.exec('PRAGMA user_version = 21')
        legacy.close()

        const migrated = new Store(dbPath)
        const session = migrated.sessions.getOrCreateSession('migration-pin', {}, null, 'default')
        expect(session.pinned).toBe(false)
        expect(session.globalPinned).toBe(false)
        migrated.close()
    })
})
