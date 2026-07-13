import { Hono, type Context } from 'hono'
import { CreateGrantRequestSchema, type ResourceGrantSummary } from '@hapi/protocol'
import type { WebAppEnv } from '../middleware/auth'
import type { Store } from '../../store'
import type { ResourceType, StoredResourceGrant } from '../../store/types'
import { authorizeResource } from '../../auth/access'

function toGrantSummary(g: StoredResourceGrant, granteeUsername?: string): ResourceGrantSummary {
    return {
        id: g.id,
        resourceType: g.resourceType,
        resourceId: g.resourceId,
        granteeAccountId: g.granteeAccountId,
        granteeUsername,
        role: g.role,
        createdAt: g.createdAt
    }
}

/**
 * Resource sharing routes. The caller must own the resource (or be admin) to
 * view or modify its grants — this is the same ownership check the resource's
 * own routes use, applied here at the grant layer.
 */
export function createGrantRoutes(store: Store): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // Returns true if the caller may administer grants on this resource.
    const callerOwnsResource = (c: Context<WebAppEnv>, type: ResourceType, id: string): boolean => {
        return authorizeResource({ store, accountId: c.get('accountId'), namespace: c.get('namespace'),
            resourceType: type, resourceId: id, capability: 'administer' }).ok
    }

    app.get('/grants', (c) => {
        const type = c.req.query('resourceType')
        const id = c.req.query('resourceId')
        if ((type !== 'machine' && type !== 'session') || !id) {
            return c.json({ error: 'resourceType and resourceId are required' }, 400)
        }
        if (!callerOwnsResource(c, type, id)) {
            return c.json({ error: 'Resource access denied' }, 403)
        }
        const grants = store.grants.listForResource(type, id).map((g) =>
            toGrantSummary(g, store.accounts.getById(g.granteeAccountId)?.username)
        )
        return c.json({ grants })
    })

    app.post('/grants', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = CreateGrantRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        const { resourceType, resourceId, granteeUsername, role } = parsed.data
        if (!callerOwnsResource(c, resourceType, resourceId)) {
            return c.json({ error: 'Resource access denied' }, 403)
        }
        const grantee = store.accounts.getByUsername(granteeUsername)
        if (!grantee) {
            return c.json({ error: 'Grantee account not found' }, 404)
        }
        // Granting to the owner themselves is a no-op that would be confusing;
        // reject it explicitly.
        if (grantee.id === c.get('accountId')) {
            return c.json({ error: 'Cannot grant access to yourself' }, 400)
        }
        const resource = resourceType === 'session'
            ? store.sessions.getSession(resourceId)
            : store.machines.getMachine(resourceId)
        if (!resource) throw new Error('Authorized resource disappeared before grant creation')
        store.identity.addNamespaceMembership(resource.namespace, grantee.id)
        const grant = store.grants.upsert({
            resourceType,
            resourceId,
            granteeAccountId: grantee.id,
            role
        })
        return c.json({ grant: toGrantSummary(grant, grantee.username) }, 201)
    })

    app.delete('/grants', async (c) => {
        const type = c.req.query('resourceType')
        const id = c.req.query('resourceId')
        const grantee = c.req.query('granteeAccountId')
        if ((type !== 'machine' && type !== 'session') || !id || !grantee) {
            return c.json({ error: 'resourceType, resourceId and granteeAccountId are required' }, 400)
        }
        if (!callerOwnsResource(c, type, id)) {
            return c.json({ error: 'Resource access denied' }, 403)
        }
        const granteeId = Number(grantee)
        if (!Number.isInteger(granteeId)) {
            return c.json({ error: 'Invalid granteeAccountId' }, 400)
        }
        const ok = store.grants.remove(type, id, granteeId)
        if (!ok) {
            return c.json({ error: 'Grant not found' }, 404)
        }
        return c.json({ ok: true })
    })

    return app
}
