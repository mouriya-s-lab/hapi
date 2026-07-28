import { describe, expect, it } from 'bun:test'
import { Store } from '../../hub/src/store'
import { buildUsageSummaryResponse, parseIsoParam } from './usageAggregate'

function makeStore(): Store {
    return new Store(':memory:')
}

function makeSession(store: Store, tag: string) {
    return store.sessions.getOrCreateSession(tag, { path: `/tmp/${tag}` }, null, 'default')
}

/** 构造与 CLI 实时同步/导入写库一致的 assistant 消息信封。 */
function assistantEnvelope(input: {
    messageId: string
    model: string
    timestamp: string
    usage?: { input?: number; output?: number; cacheCreation?: number; cacheRead?: number }
}) {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                timestamp: input.timestamp,
                message: {
                    id: input.messageId,
                    model: input.model,
                    usage: {
                        input_tokens: input.usage?.input ?? 0,
                        output_tokens: input.usage?.output ?? 0,
                        cache_creation_input_tokens: input.usage?.cacheCreation ?? 0,
                        cache_read_input_tokens: input.usage?.cacheRead ?? 0
                    }
                }
            }
        }
    }
}

// 直接经 MessageStore 接缝调用，同时覆盖 fork 接缝与底层 SQL。
describe('aggregateUsageForSessions', () => {
    it('同一 message.id 的多行只按一次请求计数（Claude Code 每个 content block 写一行，usage 整份重复）', () => {
        const store = makeStore()
        const session = makeSession(store, 'dedup')
        const envelope = assistantEnvelope({
            messageId: 'msg_turn_1',
            model: 'claude-fable-5',
            timestamp: '2026-07-20T10:00:00.000Z',
            usage: { input: 100, output: 50, cacheCreation: 10, cacheRead: 1000 }
        })
        store.messages.addMessage(session.id, envelope)
        store.messages.addMessage(session.id, envelope)
        store.messages.addMessage(session.id, envelope)

        const rows = store.messages.aggregateUsageForSessions([session.id])
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
            model: 'claude-fable-5',
            requestCount: 1,
            inputTokens: 100,
            outputTokens: 50,
            cacheCreationInputTokens: 10,
            cacheReadInputTokens: 1000
        })
    })

    it('不同模型分开聚合，非 assistant 行与缺 message.id 的行被忽略', () => {
        const store = makeStore()
        const session = makeSession(store, 'models')
        store.messages.addMessage(session.id, assistantEnvelope({
            messageId: 'msg_a', model: 'claude-fable-5', timestamp: '2026-07-20T10:00:00.000Z', usage: { input: 10 }
        }))
        store.messages.addMessage(session.id, assistantEnvelope({
            messageId: 'msg_b', model: 'claude-opus-5', timestamp: '2026-07-20T11:00:00.000Z', usage: { output: 20 }
        }))
        // 用户消息（不含 usage 结构）不计入
        store.messages.addMessage(session.id, { role: 'user', content: { type: 'text', text: 'hi "usage" mention' } })
        // agent 行但缺 message.id（如控制帧）不计入
        store.messages.addMessage(session.id, {
            role: 'agent',
            content: { type: 'output', data: { type: 'assistant', timestamp: '2026-07-20T12:00:00.000Z', message: { model: 'x', usage: { input_tokens: 999 } } } }
        })

        const rows = store.messages.aggregateUsageForSessions([session.id])
        const models = rows.map(r => r.model).sort()
        expect(models).toEqual(['claude-fable-5', 'claude-opus-5'])
        expect(rows.reduce((sum, r) => sum + r.inputTokens, 0)).toBe(10)
        expect(rows.reduce((sum, r) => sum + r.outputTokens, 0)).toBe(20)
    })

    it('since 含端点、until 为开区间，按 content.data.timestamp 而非 created_at 过滤', () => {
        const store = makeStore()
        const session = makeSession(store, 'time')
        const at = (day: string, id: string) => store.messages.addMessage(session.id, assistantEnvelope({
            messageId: id, model: 'm', timestamp: `2026-07-${day}T00:00:00.000Z`, usage: { input: 1 }
        }))
        at('10', 'msg_1')
        at('15', 'msg_2')
        at('20', 'msg_3')

        const middle = store.messages.aggregateUsageForSessions([session.id], {
            sinceIso: '2026-07-15T00:00:00.000Z',
            untilIso: '2026-07-20T00:00:00.000Z'
        })
        expect(middle[0]?.requestCount).toBe(1)

        const fromMiddle = store.messages.aggregateUsageForSessions([session.id], { sinceIso: '2026-07-15T00:00:00.000Z' })
        expect(fromMiddle[0]?.requestCount).toBe(2)
    })

    it('只统计传入的 sessionIds；空列表直接返回空', () => {
        const store = makeStore()
        const mine = makeSession(store, 'mine')
        const theirs = makeSession(store, 'theirs')
        store.messages.addMessage(mine.id, assistantEnvelope({
            messageId: 'msg_mine', model: 'm', timestamp: '2026-07-20T10:00:00.000Z', usage: { input: 5 }
        }))
        store.messages.addMessage(theirs.id, assistantEnvelope({
            messageId: 'msg_theirs', model: 'm', timestamp: '2026-07-20T10:00:00.000Z', usage: { input: 7 }
        }))

        const rows = store.messages.aggregateUsageForSessions([mine.id])
        expect(rows[0]?.inputTokens).toBe(5)
        expect(store.messages.aggregateUsageForSessions([])).toEqual([])
    })
})

describe('parseIsoParam', () => {
    it('接受 ISO 串并规整为 UTC ISO', () => {
        expect(parseIsoParam('2026-07-20T10:00:00.000Z')).toBe('2026-07-20T10:00:00.000Z')
    })
    it('接受毫秒时间戳数字串', () => {
        expect(parseIsoParam('0')).toBe('1970-01-01T00:00:00.000Z')
    })
    it('非法/空输入返回 null（= 不筛选）', () => {
        expect(parseIsoParam(undefined)).toBeNull()
        expect(parseIsoParam('')).toBeNull()
        expect(parseIsoParam('not-a-date')).toBeNull()
    })
})

describe('buildUsageSummaryResponse', () => {
    it('按合计降序排序并汇总 totals', () => {
        const small = { model: 'small', requestCount: 1, inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }
        const large = { model: 'large', requestCount: 2, inputTokens: 100, outputTokens: 100, cacheCreationInputTokens: 100, cacheReadInputTokens: 100 }
        const response = buildUsageSummaryResponse([small, large], ['vircs'], { since: null, until: null, host: null }, 123)
        expect(response.models.map(m => m.model)).toEqual(['large', 'small'])
        expect(response.totals).toEqual({
            requestCount: 3,
            inputTokens: 101,
            outputTokens: 101,
            cacheCreationInputTokens: 100,
            cacheReadInputTokens: 100
        })
        expect(response.hosts).toEqual(['vircs'])
        expect(response.generatedAt).toBe(123)
    })
})
