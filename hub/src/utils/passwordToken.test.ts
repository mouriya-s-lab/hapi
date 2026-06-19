import { describe, expect, it } from 'bun:test'
import { hashPassword, verifyPassword } from './password'
import { generateApiToken, hashApiToken } from './apiToken'

describe('password hashing', () => {
    it('verifies a correct password', () => {
        const hash = hashPassword('correct horse battery staple')
        expect(verifyPassword('correct horse battery staple', hash)).toBe(true)
    })

    it('rejects an incorrect password', () => {
        const hash = hashPassword('s3cret')
        expect(verifyPassword('wrong', hash)).toBe(false)
    })

    it('produces distinct hashes for the same password (random salt)', () => {
        expect(hashPassword('same')).not.toBe(hashPassword('same'))
    })

    it('rejects null/empty/malformed stored hashes', () => {
        expect(verifyPassword('x', null)).toBe(false)
        expect(verifyPassword('x', undefined)).toBe(false)
        expect(verifyPassword('x', '')).toBe(false)
        expect(verifyPassword('x', 'not-a-real-hash')).toBe(false)
        expect(verifyPassword('x', 'scrypt$bad$params')).toBe(false)
    })
})

describe('api token hashing', () => {
    it('generates url-safe tokens of meaningful length', () => {
        const t = generateApiToken()
        expect(t.length).toBeGreaterThanOrEqual(40)
        expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('hashes deterministically', () => {
        const t = generateApiToken()
        expect(hashApiToken(t)).toBe(hashApiToken(t))
    })

    it('different tokens hash differently', () => {
        expect(hashApiToken(generateApiToken())).not.toBe(hashApiToken(generateApiToken()))
    })
})
