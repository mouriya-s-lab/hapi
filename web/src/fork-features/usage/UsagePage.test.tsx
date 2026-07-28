import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import UsagePage, { formatTokens, localDayEndExclusiveIso, localDayStartIso } from './UsagePage'

vi.mock('@/lib/app-context', () => ({ useAppContext: () => ({ baseUrl: 'http://hub', token: 'jwt', user: { id: 1 } }) }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

afterEach(() => vi.unstubAllGlobals())

function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider><UsagePage /></I18nProvider>
        </QueryClientProvider>
    )
}

const summaryBody = {
    models: [{
        model: 'claude-fable-5',
        requestCount: 42,
        inputTokens: 1000,
        outputTokens: 2000,
        cacheCreationInputTokens: 500,
        cacheReadInputTokens: 1_500_000
    }],
    totals: { requestCount: 42, inputTokens: 1000, outputTokens: 2000, cacheCreationInputTokens: 500, cacheReadInputTokens: 1_500_000 },
    hosts: ['peter-mac', 'vircs'],
    filter: { since: null, until: null, host: null },
    generatedAt: 1
}

describe('UsagePage', () => {
    it('渲染按模型聚合的总览与机器下拉', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(summaryBody), { status: 200 })))
        renderPage()

        expect((await screen.findAllByText('claude-fable-5')).length).toBeGreaterThan(0)
        // hosts 下拉包含服务端返回的机器
        expect(screen.getByRole('option', { name: 'vircs' })).toBeTruthy()
        // 预设时间范围与自定义（日历）按钮都在
        expect(screen.getByRole('button', { name: 'All time' })).toBeTruthy()
        expect(screen.getByRole('button', { name: /Custom/ })).toBeTruthy()
    })

    it('自定义日历范围把 since/until 带进请求', async () => {
        const calls: string[] = []
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            calls.push(String(url))
            return new Response(JSON.stringify(summaryBody), { status: 200 })
        }))
        renderPage()
        await screen.findAllByText('claude-fable-5')

        fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
        // 选本月 1 号和 2 号（日期选择器初始显示当月）
        fireEvent.click(screen.getByRole('button', { name: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toLocaleDateString() }))
        fireEvent.click(screen.getByRole('button', { name: new Date(new Date().getFullYear(), new Date().getMonth(), 2).toLocaleDateString() }))

        await waitFor(() => {
            const withRange = calls.find(url => url.includes('since=') && url.includes('until='))
            expect(withRange).toBeTruthy()
        })
    })
})

describe('本地日期换算', () => {
    it('start 取当天本地零点，end 为次日零点（开区间上界），跨月正确进位', () => {
        expect(new Date(localDayStartIso('2026-07-20')!).getTime()).toBe(new Date(2026, 6, 20).getTime())
        expect(new Date(localDayEndExclusiveIso('2026-07-20')!).getTime()).toBe(new Date(2026, 6, 21).getTime())
        expect(new Date(localDayEndExclusiveIso('2026-07-31')!).getTime()).toBe(new Date(2026, 7, 1).getTime())
    })
    it('非法输入返回 null', () => {
        expect(localDayStartIso('')).toBeNull()
        expect(localDayStartIso('not-a-day')).toBeNull()
    })
})

describe('formatTokens', () => {
    it('按数量级缩写', () => {
        expect(formatTokens(999)).toBe('999')
        expect(formatTokens(1500)).toBe('1.5K')
        expect(formatTokens(2_500_000)).toBe('2.50M')
        expect(formatTokens(28_390_000_000)).toBe('28.39B')
    })
})
