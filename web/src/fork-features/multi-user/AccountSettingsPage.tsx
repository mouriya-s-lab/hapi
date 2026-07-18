import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsPageContent, SettingsRow, SettingsSection } from '@/components/settings/SettingsPrimitives'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { type ApiToken, settingsInputClass, useSettingsRequest } from './settingsApi'

export default function AccountSettingsPage() {
    const { user } = useAppContext()
    const { t } = useTranslation()
    const request = useSettingsRequest()
    const [memory, setMemory] = useState('')
    const [tokens, setTokens] = useState<ApiToken[]>([])
    const [name, setName] = useState('')
    const [plaintext, setPlaintext] = useState<string | null>(null)
    const [pending, setPending] = useState<string[]>([])
    const [error, setError] = useState<string | null>(null)
    const load = useCallback(async () => {
        try {
            const [memoryResult, tokenResult] = await Promise.all([request<{ memory: string | null }>('/api/memory'), request<{ tokens: ApiToken[] }>('/api/tokens')])
            setMemory(memoryResult.memory ?? ''); setTokens(tokenResult.tokens); setError(null)
        } catch (cause) { setError(cause instanceof Error ? cause.message : t('settings.fork.error.load')) }
    }, [request])
    useEffect(() => { void load() }, [load])
    const run = async (key: string, action: () => Promise<void>) => {
        setPending(current => [...current, key]); setError(null)
        try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : t('settings.fork.error.action')) }
        finally { setPending(current => current.filter(item => item !== key)) }
    }
    return <SettingsPageContent title={t('settings.fork.account.title')} description={t('settings.fork.account.pageDescription')}>
        {error ? <div role="alert" className="text-sm text-red-500">{error}</div> : null}
        <SettingsSection title={t('settings.fork.account.memory')}><div className="space-y-3 p-3"><textarea aria-label={t('settings.fork.account.memory')} className={`${settingsInputClass} min-h-28 resize-y`} maxLength={4000} value={memory} onChange={event => setMemory(event.target.value)} /><div className="flex justify-end"><Button size="sm" disabled={pending.includes('memory')} onClick={() => void run('memory', async () => { await request('/api/memory', { method: 'PATCH', body: JSON.stringify({ memory: memory.trim() || null }) }) })}>{t('settings.fork.action.save')}</Button></div></div></SettingsSection>
        <SettingsSection title={t('settings.fork.account.tokens')}><div className="space-y-3 p-3"><form className="flex gap-2" onSubmit={event => { event.preventDefault(); void run('token', async () => { const result = await request<{ plaintext: string }>('/api/tokens', { method: 'POST', body: JSON.stringify({ name: name || null }) }); setPlaintext(result.plaintext); setName(''); await load() }) }}><input className={settingsInputClass} placeholder={t('settings.fork.account.tokenName')} value={name} onChange={event => setName(event.target.value)} /><Button disabled={pending.includes('token')}>{t('settings.fork.action.create')}</Button></form>{plaintext ? <SettingsRow label={t('settings.fork.account.copyNow')} description={plaintext} trailing={<Button size="sm" variant="outline" onClick={() => setPlaintext(null)}>{t('settings.fork.account.copied')}</Button>} /> : null}{tokens.map(token => <SettingsRow key={token.id} label={token.name || `token-${token.id}`} description={user.defaultNamespace} trailing={<Button size="sm" variant="destructive" disabled={pending.includes(`revoke-${token.id}`)} onClick={() => void run(`revoke-${token.id}`, async () => { await request(`/api/tokens/${token.id}`, { method: 'DELETE' }); await load() })}>{t('settings.fork.account.revoke')}</Button>} />)}</div></SettingsSection>
    </SettingsPageContent>
}
