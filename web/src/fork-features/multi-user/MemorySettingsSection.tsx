import { useCallback, useEffect, useState } from 'react'
import { useAppContext } from '@/lib/app-context'
import { Button } from '@/components/ui/button'
import { SettingsSection } from '@/components/settings/SettingsPrimitives'

export function MemorySettingsSection() {
    const context = useAppContext()
    const [memory, setMemory] = useState('')
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
        const response = await fetch(`${context.baseUrl}${path}`, {
            ...init,
            headers: { authorization: `Bearer ${context.token}`, 'content-type': 'application/json', ...init?.headers }
        })
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `HTTP ${response.status}`)
        return response.json()
    }, [context.baseUrl, context.token])

    useEffect(() => {
        void request<{ memory: string | null }>('/api/memory')
            .then(result => setMemory(result.memory ?? ''))
            .catch(cause => setError(cause instanceof Error ? cause.message : '加载失败'))
    }, [request])

    const save = async () => {
        setPending(true); setError(null)
        try {
            const result = await request<{ memory: string | null }>('/api/memory', {
                method: 'PATCH', body: JSON.stringify({ memory: memory.trim() || null })
            })
            setMemory(result.memory ?? '')
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '保存失败')
        } finally {
            setPending(false)
        }
    }

    return <SettingsSection title="我的记忆" description="仅在投递给 agent 时附加；聊天记录保留原始消息。">
        <div className="space-y-2 px-4 py-3">
            <textarea className="min-h-28 w-full resize-y rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm" maxLength={4000} value={memory} disabled={pending} placeholder="例如：我的电脑是 ALICE-PC" onChange={event => setMemory(event.target.value)} />
            {error ? <div role="alert" className="text-sm text-red-500">{error}</div> : null}
            <div className="flex items-center justify-between gap-3"><span className="text-xs text-[var(--app-hint)]">{memory.length}/4000 · 下一条消息生效</span><Button size="sm" disabled={pending} onClick={save}>{pending ? '保存中…' : '保存记忆'}</Button></div>
        </div>
    </SettingsSection>
}
