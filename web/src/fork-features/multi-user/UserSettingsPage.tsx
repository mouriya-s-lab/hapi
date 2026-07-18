import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { SettingsPageContent, SettingsRow, SettingsSection } from '@/components/settings/SettingsPrimitives'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { type Account, type Grant, type Machine, settingsInputClass, useSettingsRequest } from './settingsApi'

type MachineGrant = { machine: Machine; role: Grant['role'] | null }

export default function UserSettingsPage() {
    const { accountId } = useParams({ strict: false }) as { accountId: string }
    const creating = accountId === 'new'
    const { user } = useAppContext()
    const { t } = useTranslation()
    const request = useSettingsRequest()
    const navigate = useNavigate()
    const [account, setAccount] = useState<Account | null>(null)
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState<'admin' | 'user'>('user')
    const [memory, setMemory] = useState('')
    const [machineGrants, setMachineGrants] = useState<MachineGrant[]>([])
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState<string | null>(null)

    const load = useCallback(async () => {
        if (creating || user.role !== 'admin') return
        try {
            const [{ accounts }, { machines }] = await Promise.all([
                request<{ accounts: Account[] }>('/api/accounts'),
                request<{ machines: Machine[] }>('/api/machines'),
            ])
            const found = accounts.find(item => item.id === Number(accountId)) ?? null
            setAccount(found)
            setMemory(found?.memory ?? '')
            if (found) {
                const grants = await Promise.all(machines.map(async machine => {
                    const result = await request<{ grants: Grant[] }>(`/api/grants/machine/${encodeURIComponent(machine.id)}`)
                    return { machine, role: result.grants.find(grant => grant.accountId === found.id)?.role ?? null }
                }))
                setMachineGrants(grants)
            }
            setError(found ? null : t('settings.fork.user.notFound'))
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('settings.fork.error.load'))
        }
    }, [accountId, creating, request, t, user.role])

    useEffect(() => { void load() }, [load])

    const run = async (key: string, action: () => Promise<void>) => {
        if (pending) return
        setPending(key)
        setError(null)
        try { await action() } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('settings.fork.error.action'))
        } finally { setPending(null) }
    }

    const mutate = async (body: object) => {
        if (!account) return
        await run('account', async () => {
            await request(`/api/accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify(body) })
            await load()
        })
    }

    if (user.role !== 'admin') return <Navigate to="/settings" replace />

    if (creating) return <SettingsPageContent title={t('settings.fork.users.create')} backLabel={t('settings.fork.user.backToUsers')} onBack={() => navigate({ to: '/settings/users' })}>
        <SettingsSection><form className="space-y-3 p-3" onSubmit={event => {
            event.preventDefault()
            void run('create', async () => {
                const result = await request<{ account: Account }>('/api/accounts', { method: 'POST', body: JSON.stringify({ username: username.trim(), password, role }) })
                await navigate({ to: '/settings/users/$accountId', params: { accountId: String(result.account.id) }, replace: true })
            })
        }}>
            <input aria-label={t('settings.fork.user.username')} className={settingsInputClass} placeholder={t('settings.fork.user.username')} value={username} onChange={event => setUsername(event.target.value)} />
            <input aria-label={t('settings.fork.user.initialPassword')} className={settingsInputClass} type="password" placeholder={t('settings.fork.user.initialPassword')} value={password} onChange={event => setPassword(event.target.value)} />
            <select aria-label={t('settings.fork.user.role')} className={settingsInputClass} value={role} onChange={event => setRole(event.target.value as 'admin' | 'user')}><option value="user">{t('settings.fork.user.roleUser')}</option><option value="admin">{t('settings.fork.user.roleAdmin')}</option></select>
            {error ? <div role="alert" className="text-sm text-red-500">{error}</div> : null}
            <div className="flex justify-end"><Button disabled={!username.trim() || password.length < 8 || pending !== null}>{t('settings.fork.action.create')}</Button></div>
        </form></SettingsSection>
    </SettingsPageContent>

    if (!account) return <SettingsPageContent title={t('settings.fork.user.title')} backLabel={t('settings.fork.user.backToUsers')} onBack={() => navigate({ to: '/settings/users' })}><SettingsSection><SettingsRow label={error ?? t('settings.fork.loading')} /></SettingsSection></SettingsPageContent>
    const current = account.id === user.id

    return <SettingsPageContent title={account.username} description={account.defaultNamespace} backLabel={t('settings.fork.user.backToUsers')} onBack={() => navigate({ to: '/settings/users' })}>
        {error ? <div role="alert" className="text-sm text-red-500">{error}</div> : null}
        <SettingsSection title={t('settings.fork.user.account')}>
            <SettingsRow label={t('settings.fork.user.role')} trailing={<Button size="sm" variant="outline" disabled={current || pending !== null} onClick={() => void mutate({ role: account.role === 'admin' ? 'user' : 'admin' })}>{account.role}</Button>} />
            <SettingsRow label={t('settings.fork.user.status')} trailing={<Button size="sm" variant="outline" disabled={current || pending !== null} onClick={() => void mutate({ disabled: account.disabledAt === null })}>{account.disabledAt ? t('settings.fork.user.enable') : t('settings.fork.user.disable')}</Button>} />
            <SettingsRow label={t('settings.fork.user.resetPassword')}><div className="mt-2 flex gap-2"><input aria-label={t('settings.fork.user.newPassword')} className={settingsInputClass} type="password" placeholder={t('settings.fork.user.newPassword')} value={password} onChange={event => setPassword(event.target.value)} /><Button disabled={password.length < 8 || pending !== null} onClick={() => void mutate({ password }).then(() => setPassword(''))}>{t('settings.fork.action.save')}</Button></div></SettingsRow>
        </SettingsSection>
        <SettingsSection title={t('settings.fork.user.memory')}><div className="space-y-3 p-3"><textarea aria-label={t('settings.fork.user.memory')} className={`${settingsInputClass} min-h-28 resize-y`} value={memory} maxLength={4000} onChange={event => setMemory(event.target.value)} /><div className="flex justify-end"><Button disabled={pending !== null} onClick={() => void mutate({ memory: memory.trim() || null })}>{t('settings.fork.action.save')}</Button></div></div></SettingsSection>
        {!current ? <SettingsSection title={t('settings.fork.user.machineAccess')}>
            {machineGrants.length === 0 ? <SettingsRow label={t('settings.fork.user.noMachines')} /> : machineGrants.map(({ machine, role: grantRole }) => <SettingsRow key={machine.id} label={machine.metadata?.displayName ?? machine.metadata?.host ?? machine.id} trailing={<select aria-label={`${t('settings.fork.user.machineAccess')}: ${machine.id}`} className={settingsInputClass} disabled={pending !== null} value={grantRole ?? 'none'} onChange={event => void run(`grant-${machine.id}`, async () => {
                const next = event.target.value as Grant['role'] | 'none'
                const path = `/api/grants/machine/${encodeURIComponent(machine.id)}`
                if (next === 'none') await request(`${path}/${account.id}`, { method: 'DELETE' })
                else await request(path, { method: 'POST', body: JSON.stringify({ accountId: account.id, role: next }) })
                await load()
            })}><option value="none">{t('settings.fork.user.noAccess')}</option><option value="viewer">viewer</option><option value="operator">operator</option></select>} />)}
        </SettingsSection> : null}
        {!current ? <SettingsSection title={t('settings.fork.user.danger')}><SettingsRow label={t('settings.fork.user.delete')} trailing={<Button variant="destructive" disabled={pending !== null} onClick={() => {
            if (!window.confirm(t('settings.fork.user.deleteConfirm', { username: account.username }))) return
            void run('delete', async () => {
                await request(`/api/accounts/${account.id}`, { method: 'DELETE' })
                await navigate({ to: '/settings/users', replace: true })
            })
        }}>{t('settings.fork.action.delete')}</Button>} /></SettingsSection> : null}
    </SettingsPageContent>
}
