// 一次性 e2e 种子脚本：给临时 dataDir 的 hapi.db 灌入带 usage 的会话消息，
// 用于本地真实浏览器验证 /usage 页面。不要对生产库跑。
import { join } from 'node:path'
import { Store } from '../src/store'

const dataDir = process.env.HAPI_HOME
if (!dataDir) {
    console.error('HAPI_HOME is required (refusing to touch the default ~/.hapi)')
    process.exit(1)
}

const store = new Store(join(dataDir, 'hapi.db'))

function envelope(messageId: string, model: string, timestamp: string, usage: { input: number; output: number; cacheCreation: number; cacheRead: number }) {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                timestamp,
                message: {
                    id: messageId,
                    model,
                    usage: {
                        input_tokens: usage.input,
                        output_tokens: usage.output,
                        cache_creation_input_tokens: usage.cacheCreation,
                        cache_read_input_tokens: usage.cacheRead
                    }
                }
            }
        }
    }
}

const sessions = [
    { tag: 'seed-vircs-hapi', host: 'vircs', path: 'C:/Users/Administrator/hapi' },
    { tag: 'seed-vircs-radar', host: 'vircs', path: 'C:/Users/Administrator/claude-radar' },
    { tag: 'seed-mac-web', host: 'peter-mac', path: '/Users/peter/work/web' }
]

const turns = [
    { model: 'claude-fable-5', day: '2026-07-27', input: 1200, output: 5400, cacheCreation: 90_000, cacheRead: 2_400_000 },
    { model: 'claude-fable-5', day: '2026-07-20', input: 800, output: 3100, cacheCreation: 60_000, cacheRead: 1_100_000 },
    { model: 'claude-opus-5', day: '2026-07-26', input: 500, output: 2500, cacheCreation: 30_000, cacheRead: 700_000 },
    { model: 'claude-opus-5', day: '2026-07-05', input: 900, output: 4100, cacheCreation: 45_000, cacheRead: 900_000 },
    { model: 'glm-5.2', day: '2026-07-27', input: 300, output: 1200, cacheCreation: 0, cacheRead: 0 }
]

let n = 0
for (const spec of sessions) {
    const session = store.sessions.getOrCreateSession(
        spec.tag,
        { path: spec.path, host: spec.host, name: spec.tag },
        null,
        'default'
    )
    for (const turn of turns) {
        n += 1
        const id = `msg_seed_${spec.tag}_${n}`
        const env = envelope(id, turn.model, `${turn.day}T0${n % 10}:15:00.000Z`, turn)
        // 同一 turn 写两行，验证页面数字走了 message.id 去重口径
        store.messages.addMessage(session.id, env)
        store.messages.addMessage(session.id, env)
    }
    console.log(`seeded session ${session.id} (${spec.tag})`)
}

console.log(`done: ${sessions.length} sessions, ${n} turns (x2 rows each)`)
