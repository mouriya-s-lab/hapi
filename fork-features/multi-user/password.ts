import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export function hashPassword(value: string): string {
    const salt = randomBytes(16)
    const hash = scryptSync(value, salt, 32, options)
    return `scrypt$${options.N}$${options.r}$${options.p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(value: string, encoded: string | null): boolean {
    if (!encoded) return false
    const [kind, n, r, p, saltText, hashText] = encoded.split('$')
    if (kind !== 'scrypt' || !n || !r || !p || !saltText || !hashText) return false
    try {
        const expected = Buffer.from(hashText, 'base64')
        const actual = scryptSync(value, Buffer.from(saltText, 'base64'), expected.length, {
            N: Number(n), r: Number(r), p: Number(p), maxmem: options.maxmem
        })
        return expected.length === actual.length && timingSafeEqual(expected, actual)
    } catch {
        return false
    }
}
