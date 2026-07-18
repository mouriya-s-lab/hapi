import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { SettingsLinkRow, SettingsPageContent, SettingsRow, SettingsSection } from '@/components/settings/SettingsPrimitives'
import { useAppContext } from '@/lib/app-context'
import { type Account, useSettingsRequest } from './settingsApi'

export default function UsersSettingsPage() {
    const { user } = useAppContext(); const request = useSettingsRequest(); const navigate = useNavigate()
    const [accounts, setAccounts] = useState<Account[]>([]); const [error, setError] = useState<string | null>(null)
    const load = useCallback(async () => { try { setAccounts((await request<{ accounts: Account[] }>('/api/accounts')).accounts); setError(null) } catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败') } }, [request])
    useEffect(() => { if (user.role === 'admin') void load() }, [load, user.role])
    if (user.role !== 'admin') return <SettingsPageContent title="用户管理"><SettingsSection><SettingsRow label="仅管理员可访问" /></SettingsSection></SettingsPageContent>
    return <SettingsPageContent title="用户管理" description="选择用户后管理该账号；当前账号设置位于独立页面。">{error ? <div role="alert" className="text-sm text-red-500">{error}</div> : null}<SettingsSection><SettingsLinkRow label="新建用户" onClick={() => navigate({ to: '/settings/fork/users/$accountId', params: { accountId: 'new' } })} />{accounts.map(account => <SettingsLinkRow key={account.id} label={account.username} value={account.disabledAt ? '已禁用' : account.role} description={account.defaultNamespace} onClick={() => navigate({ to: '/settings/fork/users/$accountId', params: { accountId: String(account.id) } })} />)}</SettingsSection></SettingsPageContent>
}
