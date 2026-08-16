import { createHash, randomBytes } from 'node:crypto'

export const hashApiToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export function createApiToken(): { plaintext: string; hash: string } {
    const plaintext = `hapi_mu_${randomBytes(32).toString('base64url')}`
    return { plaintext, hash: hashApiToken(plaintext) }
}
