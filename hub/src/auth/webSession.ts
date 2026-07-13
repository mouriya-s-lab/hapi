import { z } from 'zod'
import type { JWTPayload } from 'jose'
import type { Store } from '../store'
import type { StoredAccount } from '../store/types'

const webSessionClaimsSchema = z.object({
    uid: z.number(),
    ns: z.string(),
    aid: z.number(),
    role: z.enum(['admin', 'user']),
    src: z.enum(['password', 'api', 'legacy', 'telegram']).optional(),
    tid: z.number().int().positive().optional()
})

export type ActiveWebSession = {
    userId: number
    namespace: string
    account: StoredAccount
    source: 'password' | 'api' | 'legacy' | 'telegram' | 'unknown'
    tokenId: number | null
}

/**
 * Parse a signed browser-session JWT and revalidate its mutable identity.
 * API-token sessions remain bound to the exact backing token row so revoking
 * that token terminates HTTP, SSE, terminal, and voice access immediately.
 */
export function resolveActiveWebSession(store: Store, payload: JWTPayload): ActiveWebSession | null {
    const parsed = webSessionClaimsSchema.safeParse(payload)
    if (!parsed.success) return null

    const claims = parsed.data
    const account = store.accounts.getById(claims.aid)
    if (!account || account.disabledAt !== null) return null

    if (claims.src === 'api') {
        if (claims.tid === undefined) return null
        const apiToken = store.apiTokens.getById(claims.tid)
        if (!apiToken
            || apiToken.revokedAt !== null
            || apiToken.accountId !== account.id
            || apiToken.namespace !== claims.ns) {
            return null
        }
    } else if (claims.tid !== undefined) {
        return null
    }

    return {
        userId: claims.uid,
        namespace: claims.ns,
        account,
        source: claims.src ?? 'unknown',
        tokenId: claims.tid ?? null
    }
}
