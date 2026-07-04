import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { AccountSummary, ResourceGrantSummary } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useOptionalAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'

/**
 * 右键"共享/授权"弹窗的目标资源。
 * directory 不是后端概念（resource_grants 只有 session|machine），
 * 目录授权 = 对目录下每个会话逐个创建 session grant。
 */
export type ShareTarget =
    | { kind: 'session'; id: string; label: string }
    | { kind: 'machine'; id: string; label: string }
    | { kind: 'directory'; label: string; sessionIds: string[] }

type GrantRole = 'viewer' | 'operator'

function inputClass() {
    return 'w-full px-3 py-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] text-sm text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-2 focus:ring-[var(--app-button)] focus:border-transparent disabled:opacity-50'
}

function GrantList(props: {
    api: ApiClient
    resourceType: 'session' | 'machine'
    resourceId: string
}) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const key = queryKeys.resourceGrants(props.resourceType, props.resourceId)
    const grantsQuery = useQuery({
        queryKey: key,
        queryFn: async () => (await props.api.listResourceGrants(props.resourceType, props.resourceId)).grants
    })
    const deleteMutation = useMutation({
        mutationFn: (granteeAccountId: number) => props.api.deleteResourceGrant({
            resourceType: props.resourceType,
            resourceId: props.resourceId,
            granteeAccountId
        }),
        onSuccess: async () => queryClient.invalidateQueries({ queryKey: key })
    })

    const grants = grantsQuery.data ?? []
    if (grantsQuery.isLoading) {
        return <div className="text-sm text-[var(--app-hint)]">{t('misc.loading')}</div>
    }
    if (grants.length === 0) {
        return <div className="text-sm text-[var(--app-hint)]">{t('share.noGrants')}</div>
    }

    return (
        <div className="flex flex-col gap-2">
            {grants.map((grant: ResourceGrantSummary) => (
                <div key={grant.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--app-border)] px-3 py-2">
                    <div className="min-w-0">
                        <span className="text-sm font-medium">{grant.granteeUsername || `#${grant.granteeAccountId}`}</span>
                        <span className="ml-2 text-xs text-[var(--app-hint)]">{grant.role}</span>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(grant.granteeAccountId)}
                    >
                        {t('share.remove')}
                    </Button>
                </div>
            ))}
        </div>
    )
}

export function ShareGrantDialog(props: {
    api: ApiClient
    target: ShareTarget | null
    onClose: () => void
}) {
    const { t } = useTranslation()
    const appContext = useOptionalAppContext()
    const queryClient = useQueryClient()
    const [username, setUsername] = useState('')
    const [role, setRole] = useState<GrantRole>('viewer')
    const [error, setError] = useState<string | null>(null)
    const [batchResult, setBatchResult] = useState<{ ok: number; total: number } | null>(null)

    const target = props.target
    const open = target !== null

    const accountsQuery = useQuery({
        queryKey: queryKeys.accounts,
        queryFn: async () => (await props.api.listAccounts()).accounts,
        enabled: open
    })
    const selectableAccounts = useMemo(
        () => (accountsQuery.data ?? []).filter((account: AccountSummary) => account.id !== appContext?.user.id && !account.disabled),
        [accountsQuery.data, appContext?.user.id]
    )

    const grantMutation = useMutation({
        mutationFn: async () => {
            if (!target) return null
            const grantee = username.trim()
            if (target.kind === 'directory') {
                let ok = 0
                for (const sessionId of target.sessionIds) {
                    try {
                        await props.api.createResourceGrant({
                            resourceType: 'session',
                            resourceId: sessionId,
                            granteeUsername: grantee,
                            role
                        })
                        ok += 1
                        void queryClient.invalidateQueries({ queryKey: queryKeys.resourceGrants('session', sessionId) })
                    } catch {
                        // 单个会话失败不阻断其余授权，结果里体现成功数
                    }
                }
                return { ok, total: target.sessionIds.length }
            }
            await props.api.createResourceGrant({
                resourceType: target.kind,
                resourceId: target.id,
                granteeUsername: grantee,
                role
            })
            await queryClient.invalidateQueries({ queryKey: queryKeys.resourceGrants(target.kind, target.id) })
            return null
        },
        onSuccess: (result) => {
            setError(null)
            if (result) {
                setBatchResult(result)
                if (result.ok < result.total) {
                    setError(t('share.batchPartialFailure', { failed: result.total - result.ok }))
                }
            }
            setUsername('')
        },
        onError: (e) => {
            setBatchResult(null)
            setError(e instanceof Error ? e.message : t('share.grantFailed'))
        }
    })

    const close = () => {
        setUsername('')
        setRole('viewer')
        setError(null)
        setBatchResult(null)
        props.onClose()
    }

    if (!target) return null

    const title = target.kind === 'session'
        ? t('share.title.session', { name: target.label })
        : target.kind === 'machine'
            ? t('share.title.machine', { name: target.label })
            : t('share.title.directory', { name: target.label })

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="truncate">{title}</DialogTitle>
                </DialogHeader>

                <div className="mt-3 flex flex-col gap-3">
                    {target.kind === 'machine' ? (
                        <div className="rounded-lg bg-[var(--app-subtle-bg)] px-3 py-2 text-xs text-[var(--app-hint)]">
                            {t('share.machineNote')}
                        </div>
                    ) : null}
                    {target.kind === 'directory' ? (
                        <div className="rounded-lg bg-[var(--app-subtle-bg)] px-3 py-2 text-xs text-[var(--app-hint)]">
                            {t('share.directoryNote', { n: target.sessionIds.length })}
                        </div>
                    ) : null}

                    <form
                        className="flex flex-col gap-2"
                        onSubmit={(e) => {
                            e.preventDefault()
                            if (username.trim()) grantMutation.mutate()
                        }}
                    >
                        {selectableAccounts.length > 0 ? (
                            <select
                                className={inputClass()}
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                            >
                                <option value="">{t('share.selectUser')}</option>
                                {selectableAccounts.map((account: AccountSummary) => (
                                    <option key={account.id} value={account.username}>
                                        {account.username}{account.role === 'admin' ? ' (admin)' : ''}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <input
                                className={inputClass()}
                                placeholder={t('share.usernamePlaceholder')}
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                            />
                        )}
                        <select
                            className={inputClass()}
                            value={role}
                            onChange={(e) => setRole(e.target.value as GrantRole)}
                        >
                            <option value="viewer">{t('share.role.viewer')}</option>
                            <option value="operator">{t('share.role.operator')}</option>
                        </select>
                        {error ? <div className="text-sm text-red-500">{error}</div> : null}
                        {batchResult && !error ? (
                            <div className="text-sm text-[var(--app-badge-success-text)]">
                                {t('share.batchDone', { ok: batchResult.ok, total: batchResult.total })}
                            </div>
                        ) : null}
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={close}>
                                {t('button.cancel')}
                            </Button>
                            <Button type="submit" size="sm" disabled={!username.trim() || grantMutation.isPending}>
                                {grantMutation.isPending ? t('share.granting') : t('share.grant')}
                            </Button>
                        </div>
                    </form>

                    {target.kind !== 'directory' ? (
                        <div className="flex flex-col gap-2">
                            <div className="text-xs font-medium uppercase tracking-wide text-[var(--app-hint)]">
                                {t('share.existing')}
                            </div>
                            <GrantList api={props.api} resourceType={target.kind} resourceId={target.id} />
                        </div>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    )
}
