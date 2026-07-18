import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsPageContent, SettingsRow, SettingsSection } from '@/components/settings/SettingsPrimitives'
import { useAppContext } from '@/lib/app-context'
import { type ApiToken, settingsInputClass, useSettingsRequest } from './settingsApi'

export default function AccountSettingsPage() {
    const { user } = useAppContext()
    const request = useSettingsRequest()
    const [memory, setMemory] = useState('')
    const [tokens, setTokens] = useState<ApiToken[]>([])
    const [name, setName] = useState('')
    const [plaintext, setPlaintext] = useState<string | null>(null)
    const [pending, setPending] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const load = useCallback(async () => {
        try {
            const [memoryResult, tokenResult] = await Promise.all([request<{ memory: string | null }>('/api/memory'), request<{ tokens: ApiToken[] }>('/api/tokens')])
            setMemory(memoryResult.memory ?? ''); setTokens(tokenResult.tokens); setError(null)
        } catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败') }
    }, [request])
    useEffect(() => { void load() }, [load])
    const run = async (key: string, action: () => Promise<void>) => { setPending(key); setError(null); try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败') } finally { setPending(null) } }
    return <SettingsPageContent title="我的账号" description="管理只属于当前登录账号的记忆与 API Token。">
        {error ? <div role="alert" className="text-sm text-red-500">{error}</div> : null}
        <SettingsSection title="Agent 记忆"><div className="space-y-3 p-3"><textarea aria-label="我的记忆" className={`${settingsInputClass} min-h-28 resize-y`} maxLength={4000} value={memory} onChange={event => setMemory(event.target.value)} /><div className="flex justify-end"><Button size="sm" disabled={pending !== null} onClick={() => void run('memory', async () => { await request('/api/memory', { method: 'PATCH', body: JSON.stringify({ memory: memory.trim() || null }) }) })}>保存</Button></div></div></SettingsSection>
        <SettingsSection title="API Token"><div className="space-y-3 p-3"><form className="flex gap-2" onSubmit={event => { event.preventDefault(); void run('token', async () => { const result = await request<{ plaintext: string }>('/api/tokens', { method: 'POST', body: JSON.stringify({ name: name || null }) }); setPlaintext(result.plaintext); setName(''); await load() }) }}><input className={settingsInputClass} placeholder="名称（如 laptop）" value={name} onChange={event => setName(event.target.value)} /><Button disabled={pending !== null}>创建</Button></form>{plaintext ? <SettingsRow label="请立即复制保存" description={plaintext} trailing={<Button size="sm" variant="outline" onClick={() => setPlaintext(null)}>已保存</Button>} /> : null}{tokens.map(token => <SettingsRow key={token.id} label={token.name || `token-${token.id}`} description={user.defaultNamespace} trailing={<Button size="sm" variant="destructive" disabled={pending !== null} onClick={() => void run(`revoke-${token.id}`, async () => { await request(`/api/tokens/${token.id}`, { method: 'DELETE' }); await load() })}>吊销</Button>} />)}</div></SettingsSection>
    </SettingsPageContent>
}
