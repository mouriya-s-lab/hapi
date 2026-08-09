import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppContext } from '@/lib/app-context'
import { SettingsChoiceGroup, SettingsLinkRow, SettingsPageContent, SettingsRow, SettingsSection } from '@/components/settings/SettingsPrimitives'
import { ShareGrantDialog, type ShareTarget } from './ShareGrantDialog'
import { useTranslation } from '@/lib/use-translation'

export type GrantSession = { id: string; metadata?: { name?: string; path?: string; worktree?: { basePath?: string } } | null }
export type GrantMachine = { id: string; metadata?: { displayName?: string; host?: string } | null }

export function buildShareTargets(sessions: GrantSession[], machines: GrantMachine[]): Array<{ key: string; target: ShareTarget }> {
    const values: Array<{ key: string; target: ShareTarget }> = []
    for (const machine of machines) values.push({ key: `machine:${machine.id}`, target: { kind: 'machine', id: machine.id, label: machine.metadata?.displayName ?? machine.metadata?.host ?? `Machine ${machine.id.slice(0, 8)}`, description: machine.metadata?.host } })
    const directories = new Map<string, string[]>()
    for (const session of sessions) {
        const label = session.metadata?.worktree?.basePath ?? session.metadata?.path
        if (label) directories.set(label, [...(directories.get(label) ?? []), session.id])
        const path = session.metadata?.worktree?.basePath ?? session.metadata?.path
        const pathName = path?.split('/').filter(Boolean).at(-1)
        values.push({ key: `session:${session.id}`, target: { kind: 'session', id: session.id, label: session.metadata?.name ?? pathName ?? `Session ${session.id.slice(0, 8)}`, description: path } })
    }
    for (const [label, sessionIds] of directories) values.push({ key: `directory:${label}`, target: { kind: 'directory', label, sessionIds } })
    return values
}

type ResourceKind = ShareTarget['kind']

export function ResourceGrantsSettingsPage() {
    const context = useAppContext()
    const { t } = useTranslation()
    const [sessions, setSessions] = useState<GrantSession[]>([])
    const [machines, setMachines] = useState<GrantMachine[]>([])
    const [kind, setKind] = useState<ResourceKind>('session')
    const [query, setQuery] = useState('')
    const [target, setTarget] = useState<ShareTarget | null>(null)
    const [error, setError] = useState<string | null>(null)
    const request = useCallback(async <T,>(path: string): Promise<T> => {
        const response = await fetch(`${context.baseUrl}${path}`, { headers: { authorization: `Bearer ${context.token}` } })
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `HTTP ${response.status}`)
        return response.json()
    }, [context.baseUrl, context.token])

    useEffect(() => {
        void Promise.all([request<{ sessions: GrantSession[] }>('/api/sessions'), request<{ machines: GrantMachine[] }>('/api/machines')])
            .then(([sessionResult, machineResult]) => { setSessions(sessionResult.sessions); setMachines(machineResult.machines) })
            .catch(cause => setError(cause instanceof Error ? cause.message : '加载失败'))
    }, [request])

    const targets = useMemo(() => buildShareTargets(sessions, machines), [machines, sessions])
    const visibleTargets = targets.filter(item => item.target.kind === kind && item.target.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

    return <SettingsPageContent title={t('settings.fork.grants.title')} description={t('settings.fork.grants.description')}>
        <SettingsSection>
            <SettingsChoiceGroup label={t('settings.fork.grants.resourceType')} value={kind} options={[
                { value: 'session', label: t('settings.fork.grants.sessions') },
                { value: 'directory', label: t('settings.fork.grants.directories') },
                { value: 'machine', label: t('settings.fork.grants.machines') }
            ]} onChange={value => { setKind(value); setQuery('') }} />
        </SettingsSection>
        <SettingsSection title={t(`settings.fork.grants.${kind}`)}>
            <div className="px-3 py-3"><input className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm" type="search" value={query} placeholder={t('settings.fork.grants.search')} aria-label={t('settings.fork.grants.search')} onChange={event => setQuery(event.target.value)} /></div>
            {error ? <div role="alert" className="text-sm text-red-500">{error}</div> : null}
            {visibleTargets.map(item => <SettingsLinkRow key={item.key} label={item.target.label} description={item.target.description ?? t('settings.fork.grants.manageHint')} onClick={() => setTarget(item.target)} />)}
            {!error && visibleTargets.length === 0 ? <SettingsRow label={t('settings.fork.grants.empty')} /> : null}
        </SettingsSection>
        <ShareGrantDialog target={target} onClose={() => setTarget(null)} />
    </SettingsPageContent>
}
