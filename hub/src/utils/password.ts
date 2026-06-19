import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// scrypt parameters. N=2^15 keeps verification well under ~100ms on the ECS
// box while staying comfortably above the OWASP minimum. Encoded into the hash
// string so future tuning stays backward-compatible.
const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32
const SALT_LEN = 16
// Node caps scrypt memory at 32 MiB by default; N=32768,r=8 needs ~128*N*r ≈
// 33.5 MiB, so raise the ceiling explicitly or the KDF throws MEMORY_LIMIT.
const SCRYPT_MAXMEM = 64 * 1024 * 1024

/**
 * Hash a plaintext password into a self-describing string:
 *   scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
 * The parameters travel with the hash so verifyPassword can reproduce the KDF
 * even if the defaults change later.
 */
export function hashPassword(plain: string): string {
    const salt = randomBytes(SALT_LEN)
    const derived = scryptSync(plain, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM })
    return [
        'scrypt',
        SCRYPT_N,
        SCRYPT_R,
        SCRYPT_P,
        salt.toString('base64'),
        derived.toString('base64')
    ].join('$')
}

/**
 * Constant-time verification of a plaintext password against a stored hash.
 * Returns false for malformed/empty inputs rather than throwing so callers can
 * treat "bad password" and "corrupt record" identically.
 */
export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
    if (typeof plain !== 'string' || typeof stored !== 'string' || !stored) {
        return false
    }

    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
        return false
    }

    const N = Number(parts[1])
    const r = Number(parts[2])
    const p = Number(parts[3])
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
        return false
    }

    let salt: Buffer
    let expected: Buffer
    try {
        salt = Buffer.from(parts[4], 'base64')
        expected = Buffer.from(parts[5], 'base64')
    } catch {
        return false
    }

    let derived: Buffer
    try {
        derived = scryptSync(plain, salt, expected.length, { N, r, p, maxmem: SCRYPT_MAXMEM })
    } catch {
        return false
    }

    return derived.length === expected.length && timingSafeEqual(derived, expected)
}
