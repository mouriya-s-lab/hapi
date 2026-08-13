import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppContext } from '@/lib/app-context'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranslation } from '@/lib/use-translation'

export type ShareTarget =
    | { kind: 'session'; id: string; label: string; description?: string }
    | { kind: 'machine'; id: string; label: string; description?: string }
    | { kind: 'directory'; label: string; sessionIds: string[]; description?: string }
type Account = { id: number; username: string; disabledAt: number | null }
type Grant = { accountId: number; role: 'viewer' | 'operator' }

export function ShareGrantDialog({ target, onClose }: { target: ShareTarget | null; onClose: () => void }) {
    const context = useAppContext()
    const { t } = useTranslation()
    const [accounts, setAccounts] = useState<Account[]>([])
    const [grants, setGrants] = useState<Grant[]>([])
    const [accountId, setAccountId] = useState('')
    const [role, setRole] = useState<'viewer' | 'operator'>('viewer')
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)
    const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
        if (!context) throw new Error(t('settings.fork.grants.notSignedIn'))
        const response = await fetch(`${context.baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${context.token}`, 'content-type': 'application/json', ...init?.headers } })
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `HTTP ${response.status}`)
        return response.json()
    }, [context, t])
    const single = target?.kind === 'directory' ? null : target
    const refresh = useCallback(async () => {
        if (!target) return
        const accountResult = await request<{ accounts: Account[] }>('/api/accounts')
        setAccounts(accountResult.accounts.filter(account => account.id !== context?.user.id && !account.disabledAt))
        if (single) setGrants((await request<{ grants: Grant[] }>(`/api/grants/${single.kind}/${single.id}`)).grants)
        else if (target.kind === 'directory') {
            const results = await Promise.all(target.sessionIds.map(id => request<{ grants: Grant[] }>(`/api/grants/session/${id}`)))
            setGrants(Array.from(new Map(results.flatMap(result => result.grants).map(grant => [`${grant.accountId}:${grant.role}`, grant])).values()))
        }
    }, [context?.user.id, request, single, target])
    useEffect(() => { if (target) void refresh().catch(cause => setError(cause instanceof Error ? cause.message : t('settings.fork.grants.loadFailed'))) }, [refresh, t, target])
    const available = useMemo(() => accounts.filter(account => !grants.some(grant => grant.accountId === account.id)), [accounts, grants])
    const add = async () => {
        if (!target || !accountId) return
        setPending(true); setError(null)
        try {
            const ids = target.kind === 'directory' ? target.sessionIds : [target.id]
            const kind = target.kind === 'directory' ? 'session' : target.kind
            await Promise.all(ids.map(id => request(`/api/grants/${kind}/${id}`, { method: 'POST', body: JSON.stringify({ accountId: Number(accountId), role }) })))
            await refresh(); setAccountId('')
        } catch (cause) { setError(cause instanceof Error ? cause.message : t('settings.fork.grants.updateFailed')) }
        finally { setPending(false) }
    }
    const remove = async (id: number) => {
        if (!target) return
        setPending(true); setError(null)
        try {
            const resourceIds = target.kind === 'directory' ? target.sessionIds : [target.id]
            const kind = target.kind === 'directory' ? 'session' : target.kind
            await Promise.all(resourceIds.map(resourceId => request(`/api/grants/${kind}/${resourceId}/${id}`, { method: 'DELETE' }).catch(() => null)))
            await refresh()
        }
        catch (cause) { setError(cause instanceof Error ? cause.message : t('settings.fork.grants.removeFailed')) }
        finally { setPending(false) }
    }
    return <Dialog open={target !== null} onOpenChange={open => { if (!open && !pending) onClose() }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{t('settings.fork.grants.dialogTitle', { resource: target?.label ?? '' })}</DialogTitle></DialogHeader><div className="mt-4 space-y-3">{error && <div role="alert" className="text-sm text-red-500">{error}</div>}<div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"><select aria-label={t('settings.fork.grants.user')} className="rounded-lg border bg-[var(--app-bg)] px-3 py-2" value={accountId} onChange={event => setAccountId(event.target.value)}><option value="">{t('settings.fork.grants.selectUser')}</option>{available.map(account => <option key={account.id} value={account.id}>{account.username}</option>)}</select><select aria-label={t('settings.fork.grants.role')} className="rounded-lg border bg-[var(--app-bg)] px-2" value={role} onChange={event => setRole(event.target.value as 'viewer' | 'operator')}><option value="viewer">viewer</option><option value="operator">operator</option></select><Button disabled={!accountId || pending} onClick={add}>{t('settings.fork.grants.add')}</Button></div>{target?.kind === 'directory' && <div className="text-sm text-[var(--app-hint)]">{t('settings.fork.grants.directoryScope', { count: target.sessionIds.length })}</div>}{grants.map(grant => <div key={`${grant.accountId}:${grant.role}`} className="flex items-center justify-between rounded-lg border p-2"><span>{accounts.find(account => account.id === grant.accountId)?.username ?? `#${grant.accountId}`} · {grant.role}</span><Button size="sm" variant="destructive" disabled={pending} onClick={() => remove(grant.accountId)}>{t('settings.fork.grants.remove')}</Button></div>)}</div></DialogContent></Dialog>
}
