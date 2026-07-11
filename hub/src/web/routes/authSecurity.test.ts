import { describe, expect, it } from 'bun:test'
import { Store } from '../../store'
import { hashPassword } from '../../utils/password'
import { createAuthRoutes } from './auth'

const JWT_SECRET = new TextEncoder().encode('multi-user-auth-security-test-secret')

function login(app: ReturnType<typeof createAuthRoutes>, username: string, password: string, client = '192.0.2.1') {
    return app.request('/auth', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-forwarded-for': client
        },
        body: JSON.stringify({ username, password })
    })
}

describe('password login security', () => {
    it('issues a user-scoped session and clears accumulated failures after success', async () => {
        const store = new Store(':memory:')
        store.accounts.create({
            username: 'alice',
            passwordHash: hashPassword('correct horse battery staple'),
            role: 'user',
            defaultNamespace: 'alice'
        })
        const app = createAuthRoutes(JWT_SECRET, store)

        for (let attempt = 0; attempt < 9; attempt += 1) {
            expect((await login(app, 'alice', 'wrong')).status).toBe(401)
        }
        const success = await login(app, 'alice', 'correct horse battery staple')
        expect(success.status).toBe(200)
        expect((await success.json() as { user: { role: string } }).user.role).toBe('user')
        expect((await login(app, 'alice', 'wrong')).status).toBe(401)
    })

    it('throttles repeated failures per client and username without blocking another client', async () => {
        const app = createAuthRoutes(JWT_SECRET, new Store(':memory:'))
        for (let attempt = 0; attempt < 10; attempt += 1) {
            expect((await login(app, 'missing', 'wrong')).status).toBe(401)
        }
        expect((await login(app, 'missing', 'wrong')).status).toBe(429)
        expect((await login(app, 'missing', 'wrong', '192.0.2.2')).status).toBe(401)
    })
})
