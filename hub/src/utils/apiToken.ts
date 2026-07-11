import { createHash, randomBytes } from 'node:crypto'

/**
 * API tokens are high-entropy random secrets (not user-chosen passwords), so a
 * single SHA-256 is the right primitive for the at-rest hash: it's fast enough
 * to run on every request and there's nothing to brute-force in 256 bits of
 * randomness. This mirrors how GitHub/Stripe store PATs.
 */

const TOKEN_BYTES = 32

/**
 * Generate a fresh opaque API token. Returned plaintext is shown to the user
 * exactly once; only its hash is persisted.
 */
export function generateApiToken(): string {
    return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** Deterministic at-rest hash for a token's base part (namespace stripped). */
export function hashApiToken(baseToken: string): string {
    return createHash('sha256').update(baseToken, 'utf8').digest('hex')
}
