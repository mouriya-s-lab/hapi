import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { SettingsLinkRow, SettingsPageContent, SettingsSection } from '@/components/settings/SettingsPrimitives'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { type Account, useSettingsRequest } from './settingsApi'

export default function UsersSettingsPage() {
    const { user } = useAppContext(); const request = useSettingsRequest(); const navigate = useNavigate(); const { t } = useTranslation()
    const [accounts, setAccounts] = useState<Account[]>([]); const [error, setError] = useState<string | null>(null)
    const load = useCallback(async () => { try { setAccounts((await request<{ accounts: Account[] }>('/api/accounts')).accounts); setError(null) } catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败') } }, [request])
    useEffect(() => { if (user.role === 'admin') void load() }, [load, user.role])
    if (user.role !== 'admin') return <Navigate to="/settings" replace />
    return <SettingsPageContent title={t('settings.fork.users.title')} description={t('settings.fork.users.pageDescription')}>{error ? <div role="alert" className="text-sm text-red-500">{error}</div> : null}<SettingsSection><SettingsLinkRow label={t('settings.fork.users.create')} onClick={() => navigate({ to: '/settings/users/$accountId', params: { accountId: 'new' } })} />{accounts.map(account => <SettingsLinkRow key={account.id} label={account.username} value={account.disabledAt ? t('settings.fork.user.disabled') : account.role} description={account.defaultNamespace} onClick={() => navigate({ to: '/settings/users/$accountId', params: { accountId: String(account.id) } })} />)}</SettingsSection></SettingsPageContent>
}
