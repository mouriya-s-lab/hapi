import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { resolveAuthToken, type AuthResolverDeps } from './resolveAuth'
import { bootstrapMultiUser } from './bootstrap'
import { authorizeResource, resolveAccessLevel, canOperate, canRead, resolveResourceAudience } from './access'
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
    it('maps the legacy token to an active admin after the named admin was disabled', () => {
        const store = new Store(':memory:')
        const named = store.accounts.create({ username: 'admin', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        store.accounts.setDisabled(named.id, true)
        const active = store.accounts.create({ username: 'active-admin', passwordHash: null, role: 'admin', defaultNamespace: 'default' })
        const boot = bootstrapMultiUser(store, 'legacy')
        expect(boot.legacyAdminAccountId).toBe(active.id)
        store.close()
    })
    it('creates an admin, keeps the legacy token out of api_tokens, and backfills ownership', () => {
        const store = new Store(':memory:')
        try {
            // Pre-existing data created before multi-user.
            store.machines.getOrCreateMachine('m1', { path: '/a', host: 'h' }, null, 'default')
            const sess = store.sessions.getOrCreateSession('t1', { path: '/a', host: 'h' }, null, 'default')

            const result = bootstrapMultiUser(store, LEGACY_TOKEN)
            expect(result.createdAdmin).toBe(true)

            const admin = store.accounts.getById(result.legacyAdminAccountId)
            expect(admin?.role).toBe('admin')
            expect(store.apiTokens.getActiveByHash(hashApiToken(LEGACY_TOKEN))).toBeNull()
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

    it('persists the legacy-token principal instead of selecting another admin on restart', () => {
        const store = new Store(':memory:')
        try {
            const first = bootstrapMultiUser(store, LEGACY_TOKEN)
            store.accounts.create({ username: 'second-admin', passwordHash: null, role: 'admin', defaultNamespace: 'default' })
            expect(bootstrapMultiUser(store, LEGACY_TOKEN).legacyAdminAccountId).toBe(first.legacyAdminAccountId)
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
            const deps = makeDeps(store, boot.legacyAdminAccountId)
            const resolved = resolveAuthToken(deps, `${LEGACY_TOKEN}:team-a`)
            expect(resolved?.accountId).toBe(boot.legacyAdminAccountId)
            expect(resolved?.role).toBe('admin')
            expect(resolved?.namespace).toBe('team-a')
            expect(resolved?.tokenId).toBeNull()
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

describe('authorizeResource', () => {
    it('enforces active account, namespace, and read/operate/administer capabilities', () => {
        const store = new Store(':memory:')
        const owner = store.accounts.create({ username: 'matrix-owner', passwordHash: null, role: 'user', defaultNamespace: 'alpha' })
        const viewer = store.accounts.create({ username: 'matrix-viewer', passwordHash: null, role: 'user', defaultNamespace: 'alpha' })
        const operator = store.accounts.create({ username: 'matrix-operator', passwordHash: null, role: 'user', defaultNamespace: 'alpha' })
        const admin = store.accounts.create({ username: 'matrix-admin', passwordHash: null, role: 'admin', defaultNamespace: 'alpha' })
        const stranger = store.accounts.create({ username: 'matrix-stranger', passwordHash: null, role: 'user', defaultNamespace: 'alpha' })
        const session = store.sessions.getOrCreateSession('matrix', {}, null, 'alpha', undefined, undefined, undefined, undefined, owner.id)
        store.grants.upsert({ resourceType: 'session', resourceId: session.id, granteeAccountId: viewer.id, role: 'viewer' })
        store.grants.upsert({ resourceType: 'session', resourceId: session.id, granteeAccountId: operator.id, role: 'operator' })
        const check = (accountId: number, capability: 'read' | 'operate' | 'administer', namespace = 'alpha') =>
            authorizeResource({ store, accountId, namespace, resourceType: 'session', resourceId: session.id, capability }).ok
        expect(check(owner.id, 'administer')).toBe(true)
        expect(check(admin.id, 'administer')).toBe(true)
        expect(check(viewer.id, 'read')).toBe(true)
        expect(check(viewer.id, 'operate')).toBe(false)
        expect(check(operator.id, 'operate')).toBe(true)
        expect(check(operator.id, 'administer')).toBe(false)
        expect(check(stranger.id, 'read')).toBe(false)
        expect(check(owner.id, 'read', 'beta')).toBe(false)
        store.accounts.setDisabled(operator.id, true)
        expect(check(operator.id, 'operate')).toBe(false)
        store.close()
    })

    it('builds active read and operate audiences with admins included', () => {
        const store = new Store(':memory:')
        const owner = store.accounts.create({ username: 'aud-owner', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        const viewer = store.accounts.create({ username: 'aud-viewer', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        const operator = store.accounts.create({ username: 'aud-operator', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        const admin = store.accounts.create({ username: 'aud-admin', passwordHash: null, role: 'admin', defaultNamespace: 'default' })
        const disabled = store.accounts.create({ username: 'aud-disabled', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        const session = store.sessions.getOrCreateSession('audience', {}, null, 'default', undefined, undefined, undefined, undefined, owner.id)
        store.grants.upsert({ resourceType: 'session', resourceId: session.id, granteeAccountId: viewer.id, role: 'viewer' })
        store.grants.upsert({ resourceType: 'session', resourceId: session.id, granteeAccountId: operator.id, role: 'operator' })
        store.grants.upsert({ resourceType: 'session', resourceId: session.id, granteeAccountId: disabled.id, role: 'operator' })
        store.accounts.setDisabled(disabled.id, true)

        const read = resolveResourceAudience({ store, resourceType: 'session', resourceId: session.id, capability: 'read' })
        const operate = resolveResourceAudience({ store, resourceType: 'session', resourceId: session.id, capability: 'operate' })
        expect([...read].sort()).toEqual([owner.id, viewer.id, operator.id, admin.id].sort())
        expect([...operate].sort()).toEqual([owner.id, operator.id, admin.id].sort())
        store.close()
    })
})


describe('account resource visibility', () => {
    it('returns owned and granted resources while hiding unrelated resources', () => {
        const store = new Store(':memory:')
        try {
            const owner = store.accounts.create({ username: 'owner', passwordHash: null, role: 'user', defaultNamespace: 'default' })
            const viewer = store.accounts.create({ username: 'viewer', passwordHash: null, role: 'user', defaultNamespace: 'default' })
            const stranger = store.accounts.create({ username: 'stranger', passwordHash: null, role: 'user', defaultNamespace: 'default' })
            store.machines.getOrCreateMachine('machine-owned', { host: 'owner-host' }, null, 'default', owner.id)
            const session = store.sessions.getOrCreateSession('session-owned', { path: '/workspace' }, null, 'default', undefined, undefined, undefined, undefined, owner.id)
            store.grants.upsert({ resourceType: 'machine', resourceId: 'machine-owned', granteeAccountId: viewer.id, role: 'viewer' })
            store.grants.upsert({ resourceType: 'session', resourceId: session.id, granteeAccountId: viewer.id, role: 'operator' })

            expect(store.machines.getMachinesForAccount('default', owner.id).map((machine) => machine.id)).toEqual(['machine-owned'])
            expect(store.sessions.getSessionsForAccount('default', owner.id).map((visible) => visible.id)).toEqual([session.id])
            expect(store.machines.getMachinesForAccount('default', viewer.id).map((machine) => machine.id)).toEqual(['machine-owned'])
            expect(store.sessions.getSessionsForAccount('default', viewer.id).map((visible) => visible.id)).toEqual([session.id])
            expect(store.machines.getMachinesForAccount('default', stranger.id)).toEqual([])
            expect(store.sessions.getSessionsForAccount('default', stranger.id)).toEqual([])
        } finally {
            store.close()
        }
    })
})
