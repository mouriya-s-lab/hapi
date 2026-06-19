import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { resolveAuthToken, type AuthResolverDeps } from './resolveAuth'
import { bootstrapMultiUser } from './bootstrap'
import { resolveAccessLevel, canOperate, canRead } from './access'
import { generateApiToken, hashApiToken } from '../utils/apiToken'

const LEGACY_TOKEN = 'legacy-shared-token-abc123'

function makeDeps(store: Store, legacyAdminId: number | null): AuthResolverDeps {
    return {
        store,
        getLegacyToken: () => LEGACY_TOKEN,
        getLegacyAdminAccountId: () => legacyAdminId
    }
}

describe('bootstrapMultiUser', () => {
    it('creates an admin, registers the legacy token, backfills ownership', () => {
        const store = new Store(':memory:')
        try {
            // Pre-existing data created before multi-user.
            store.machines.getOrCreateMachine('m1', { path: '/a', host: 'h' }, null, 'default')
            const sess = store.sessions.getOrCreateSession('t1', { path: '/a', host: 'h' }, null, 'default')

            const result = bootstrapMultiUser(store, LEGACY_TOKEN)
            expect(result.createdAdmin).toBe(true)

            const admin = store.accounts.getById(result.legacyAdminAccountId)
            expect(admin?.role).toBe('admin')
            // Legacy token registered as the admin's api token.
            const tokenRow = store.apiTokens.getActiveByHash(hashApiToken(LEGACY_TOKEN))
            expect(tokenRow?.accountId).toBe(admin!.id)
            // Ownership backfilled (look up the session by its real id, not its tag).
            expect(store.machines.getMachine('m1')?.ownerAccountId).toBe(admin!.id)
            expect(store.sessions.getSession(sess.id)?.ownerAccountId).toBe(admin!.id)
        } finally {
            store.close()
        }
    })

    it('is idempotent across restarts (no duplicate admin)', () => {
        const store = new Store(':memory:')
        try {
            const first = bootstrapMultiUser(store, LEGACY_TOKEN)
            const second = bootstrapMultiUser(store, LEGACY_TOKEN)
            expect(second.createdAdmin).toBe(false)
            expect(second.legacyAdminAccountId).toBe(first.legacyAdminAccountId)
            expect(store.accounts.list().filter((a) => a.role === 'admin')).toHaveLength(1)
        } finally {
            store.close()
        }
    })
})

describe('resolveAuthToken', () => {
    it('resolves a per-user API token to its account/namespace, ignoring any suffix', () => {
        const store = new Store(':memory:')
        try {
            const boot = bootstrapMultiUser(store, LEGACY_TOKEN)
            const alice = store.accounts.create({
                username: 'alice', passwordHash: null, role: 'user', defaultNamespace: 'alice-ns'
            })
            const token = generateApiToken()
            store.apiTokens.create({
                accountId: alice.id, name: 'laptop', tokenHash: hashApiToken(token), namespace: 'alice-ns'
            })
            const deps = makeDeps(store, boot.legacyAdminAccountId)

            // Even if the client appends a different namespace suffix, the
            // token record's namespace wins (closes the self-asserted hole).
            const resolved = resolveAuthToken(deps, `${token}:attacker-ns`)
            expect(resolved?.accountId).toBe(alice.id)
            expect(resolved?.role).toBe('user')
            expect(resolved?.namespace).toBe('alice-ns')
        } finally {
            store.close()
        }
    })

    it('honours the legacy shared token as the bootstrap admin with client namespace', () => {
        const store = new Store(':memory:')
        try {
            const boot = bootstrapMultiUser(store, LEGACY_TOKEN)
            // The legacy token is also registered as an api_token by bootstrap,
            // so it resolves via the per-user path to the admin. Its namespace
            // is the token record's ('default').
            const deps = makeDeps(store, boot.legacyAdminAccountId)
            const resolved = resolveAuthToken(deps, LEGACY_TOKEN)
            expect(resolved?.accountId).toBe(boot.legacyAdminAccountId)
            expect(resolved?.role).toBe('admin')
        } finally {
            store.close()
        }
    })

    it('rejects unknown tokens and revoked tokens', () => {
        const store = new Store(':memory:')
        try {
            const boot = bootstrapMultiUser(store, LEGACY_TOKEN)
            const bob = store.accounts.create({
                username: 'bob', passwordHash: null, role: 'user', defaultNamespace: 'default'
            })
            const token = generateApiToken()
            const row = store.apiTokens.create({
                accountId: bob.id, name: 't', tokenHash: hashApiToken(token), namespace: 'default'
            })
            const deps = makeDeps(store, boot.legacyAdminAccountId)

            expect(resolveAuthToken(deps, 'totally-unknown')).toBeNull()

            store.apiTokens.revoke(row.id, bob.id)
            expect(resolveAuthToken(deps, token)).toBeNull()
        } finally {
            store.close()
        }
    })

    it('rejects tokens of disabled accounts', () => {
        const store = new Store(':memory:')
        try {
            const boot = bootstrapMultiUser(store, LEGACY_TOKEN)
            const carol = store.accounts.create({
                username: 'carol', passwordHash: null, role: 'user', defaultNamespace: 'default'
            })
            const token = generateApiToken()
            store.apiTokens.create({
                accountId: carol.id, name: 't', tokenHash: hashApiToken(token), namespace: 'default'
            })
            store.accounts.setDisabled(carol.id, true)
            const deps = makeDeps(store, boot.legacyAdminAccountId)
            expect(resolveAuthToken(deps, token)).toBeNull()
        } finally {
            store.close()
        }
    })
})

describe('resolveAccessLevel', () => {
    it('admin gets owner-level on everything', () => {
        const store = new Store(':memory:')
        try {
            const level = resolveAccessLevel({
                store, accountId: 1, role: 'admin',
                resourceType: 'machine', resourceId: 'm1', ownerAccountId: 999
            })
            expect(level).toBe('owner')
            expect(canOperate(level)).toBe(true)
        } finally {
            store.close()
        }
    })

    it('owner gets owner-level on their own resource', () => {
        const store = new Store(':memory:')
        try {
            const level = resolveAccessLevel({
                store, accountId: 7, role: 'user',
                resourceType: 'session', resourceId: 's1', ownerAccountId: 7
            })
            expect(level).toBe('owner')
        } finally {
            store.close()
        }
    })

    it('granted viewer can read but not operate; operator can do both', () => {
        const store = new Store(':memory:')
        try {
            const viewer = store.accounts.create({ username: 'v', passwordHash: null, role: 'user', defaultNamespace: 'default' })
            const operator = store.accounts.create({ username: 'o', passwordHash: null, role: 'user', defaultNamespace: 'default' })
            store.grants.upsert({ resourceType: 'machine', resourceId: 'm1', granteeAccountId: viewer.id, role: 'viewer' })
            store.grants.upsert({ resourceType: 'machine', resourceId: 'm1', granteeAccountId: operator.id, role: 'operator' })

            const vLevel = resolveAccessLevel({ store, accountId: viewer.id, role: 'user', resourceType: 'machine', resourceId: 'm1', ownerAccountId: 100 })
            const oLevel = resolveAccessLevel({ store, accountId: operator.id, role: 'user', resourceType: 'machine', resourceId: 'm1', ownerAccountId: 100 })
            expect(canRead(vLevel)).toBe(true)
            expect(canOperate(vLevel)).toBe(false)
            expect(canOperate(oLevel)).toBe(true)
        } finally {
            store.close()
        }
    })

    it('unrelated user with no grant has no access', () => {
        const store = new Store(':memory:')
        try {
            const level = resolveAccessLevel({
                store, accountId: 42, role: 'user',
                resourceType: 'session', resourceId: 's9', ownerAccountId: 1
            })
            expect(level).toBe('none')
            expect(canRead(level)).toBe(false)
        } finally {
            store.close()
        }
    })
})
