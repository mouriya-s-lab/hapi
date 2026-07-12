import { describe, expect, it, mock, spyOn } from 'bun:test'
import { HappyBot } from './bot'
import type { SyncEngine } from '../sync/syncEngine'
import type { Store } from '../store'
import { Store as RealStore } from '../store'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function createFakeStore(): Store {
    return {
        users: {
            getUsersByPlatformAndNamespace: () => [],
            getUser: () => null
        }
    } as unknown as Store
}

function createBot() {
    const bot = new HappyBot({
        syncEngine: {} as unknown as SyncEngine,
        botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
        publicUrl: 'https://example.com',
        store: createFakeStore()
    })
    return bot
}

describe('HappyBot.start', () => {
    it('logs error and resets isRunning when polling fails', async () => {
        const bot = createBot()
        const innerBot = bot.getBot()

        // Override bot.start to simulate a polling failure
        innerBot.start = mock((): Promise<void> => Promise.reject(new Error('Network failure')))

        const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

        await bot.start()
        // Allow microtask (.catch handler) to run
        await sleep(10)

        expect(errorSpy).toHaveBeenCalledWith(
            '[HAPIBot] Telegram bot polling failed:',
            'Network failure'
        )

        // isRunning should be reset, so start() should work again
        await bot.start()
        expect(innerBot.start).toHaveBeenCalledTimes(2)

        errorSpy.mockRestore()
    })

    it('does not call bot.start twice when already running', async () => {
        const bot = createBot()
        const innerBot = bot.getBot()

        // Simulate a long-running polling that never resolves
        innerBot.start = mock((): Promise<void> => new Promise(() => {}))

        await bot.start()
        await bot.start() // second call should be no-op

        expect(innerBot.start).toHaveBeenCalledTimes(1)
    })
})

describe('HappyBot account isolation', () => {
    it('sends a session notification only to bound accounts in its readable audience', async () => {
        const store = new RealStore(':memory:')
        const owner = store.accounts.create({ username: 'owner', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        const stranger = store.accounts.create({ username: 'stranger', passwordHash: null, role: 'user', defaultNamespace: 'default' })
        store.users.addUser('telegram', '101', 'default', owner.id)
        store.users.addUser('telegram', '202', 'default', stranger.id)
        const stored = store.sessions.getOrCreateSession('telegram-session', {}, null, 'default', undefined, undefined, undefined, owner.id)
        const bot = new HappyBot({
            syncEngine: {} as SyncEngine,
            botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
            publicUrl: 'https://example.com', store
        })
        const recipients: number[] = []
        bot.getBot().api.sendMessage = mock(async (chatId: number) => {
            recipients.push(chatId)
            return {} as never
        }) as never

        await bot.sendReady({ id: stored.id, namespace: 'default', active: true, metadata: {} } as never)

        expect(recipients).toEqual([101])
        store.close()
    })
})
