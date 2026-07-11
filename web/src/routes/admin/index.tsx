import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { useMachines } from '@/hooks/queries/useMachines'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { AccountSummary, ApiTokenSummary, ResourceGrantSummary, Machine } from '@/types/api'

function inputClass() {
    return 'w-full px-3 py-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-2 focus:ring-[var(--app-button)] focus:border-transparent disabled:opacity-50'
}

export default function AdminPage() {
    const { user } = useAppContext()
    const navigate = useNavigate()

    return (
        <div className="h-full min-h-0 overflow-y-auto bg-[var(--app-bg)] text-[var(--app-fg)]">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-4 py-3">
                <div>
                    <div className="text-base font-semibold">管理面板</div>
                    <div className="text-xs text-[var(--app-hint)]">用户、API Token 与机器授权</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => navigate({ to: '/sessions' })}>返回</Button>
            </div>

            <div className="mx-auto max-w-5xl space-y-4 p-4">
                {user.role !== 'admin' && (
                    <Card>
                        <CardHeader>
                            <CardTitle>仅管理员可管理用户</CardTitle>
                            <CardDescription>你仍可管理自己的 API Token。</CardDescription>
                        </CardHeader>
                    </Card>
                )}
                {user.role === 'admin' && <AccountsSection />}
                <TokensSection />
                <MachineGrantsSection />
            </div>
        </div>
    )
}

function AccountsSection() {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const [createOpen, setCreateOpen] = useState(false)
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState<'admin' | 'user'>('user')
    const [error, setError] = useState<string | null>(null)

    const accountsQuery = useQuery({
        queryKey: queryKeys.accounts,
        queryFn: async () => (await api.listAccounts()).accounts
    })

    const createMutation = useMutation({
        mutationFn: () => api.createAccount({ username: username.trim(), password: password || undefined, role }),
        onSuccess: async () => {
            setCreateOpen(false)
            setUsername('')
            setPassword('')
            setRole('user')
            setError(null)
            await queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
        },
        onError: (e) => setError(e instanceof Error ? e.message : '创建用户失败')
    })

    return (
        <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                    <CardTitle>用户</CardTitle>
                    <CardDescription>创建账号、设置角色、禁用或删除用户。</CardDescription>
                </div>
                <Button size="sm" onClick={() => setCreateOpen(true)}>新建用户</Button>
            </CardHeader>
            <CardContent className="space-y-2">
                {(accountsQuery.data ?? []).map((account) => (
                    <AccountRow key={account.id} account={account} />
                ))}
                {accountsQuery.isLoading && <div className="text-sm text-[var(--app-hint)]">加载中…</div>}
            </CardContent>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader><DialogTitle>新建用户</DialogTitle></DialogHeader>
                    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); createMutation.mutate() }}>
                        <input className={inputClass()} placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
                        <input className={inputClass()} placeholder="密码(至少8位,可稍后设置)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                        <select className={inputClass()} value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'user')}>
                            <option value="user">普通用户</option>
                            <option value="admin">管理员</option>
                        </select>
                        {error && <div className="text-sm text-red-500">{error}</div>}
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
                            <Button type="submit" disabled={!username.trim() || createMutation.isPending}>创建</Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </Card>
    )
}

function AccountRow(props: { account: AccountSummary }) {
    const { api, user } = useAppContext()
    const queryClient = useQueryClient()
    const [passwordOpen, setPasswordOpen] = useState(false)
    const [newPassword, setNewPassword] = useState('')
    const [error, setError] = useState<string | null>(null)

    const invalidate = async () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
    const roleMutation = useMutation({ mutationFn: (role: 'admin' | 'user') => api.updateAccount(props.account.id, { role }), onSuccess: invalidate })
    const disableMutation = useMutation({ mutationFn: () => api.updateAccount(props.account.id, { disabled: !props.account.disabled }), onSuccess: invalidate })
    const passwordMutation = useMutation({
        mutationFn: () => api.updateAccount(props.account.id, { password: newPassword }),
        onSuccess: async () => { setPasswordOpen(false); setNewPassword(''); setError(null); await invalidate() },
        onError: (e) => setError(e instanceof Error ? e.message : '重置密码失败')
    })
    const deleteMutation = useMutation({ mutationFn: () => api.deleteAccount(props.account.id), onSuccess: invalidate })

    return (
        <div className="rounded-lg border border-[var(--app-border)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <div className="font-medium">{props.account.username}</div>
                        <Badge variant={props.account.role === 'admin' ? 'success' : 'default'}>{props.account.role}</Badge>
                        {props.account.disabled && <Badge variant="destructive">disabled</Badge>}
                        {!props.account.hasPassword && <Badge variant="warning">no password</Badge>}
                    </div>
                    <div className="text-xs text-[var(--app-hint)]">namespace: {props.account.defaultNamespace}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => roleMutation.mutate(props.account.role === 'admin' ? 'user' : 'admin')}>{props.account.role === 'admin' ? '降为用户' : '升为管理员'}</Button>
                    <Button size="sm" variant="outline" onClick={() => setPasswordOpen(true)}>设密码</Button>
                    <Button size="sm" variant="outline" onClick={() => disableMutation.mutate()}>{props.account.disabled ? '启用' : '禁用'}</Button>
                    <Button
                        size="sm"
                        variant="destructive"
                        disabled={props.account.id === user.id}
                        onClick={() => {
                            if (window.confirm(`确定删除 ${props.account.username}？`)) {
                                deleteMutation.mutate()
                            }
                        }}
                    >删除</Button>
                </div>
            </div>

            <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader><DialogTitle>设置密码：{props.account.username}</DialogTitle></DialogHeader>
                    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); passwordMutation.mutate() }}>
                        <input className={inputClass()} type="password" placeholder="新密码(至少8位)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                        {error && <div className="text-sm text-red-500">{error}</div>}
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => setPasswordOpen(false)}>取消</Button>
                            <Button type="submit" disabled={newPassword.length < 8 || passwordMutation.isPending}>保存</Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function TokensSection() {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const [name, setName] = useState('')
    const [namespace, setNamespace] = useState('')
    const [createdToken, setCreatedToken] = useState<ApiTokenSummary | null>(null)

    const tokensQuery = useQuery({ queryKey: queryKeys.apiTokens, queryFn: async () => (await api.listApiTokens()).tokens })
    const createMutation = useMutation({
        mutationFn: () => api.createApiToken({ name: name || undefined, namespace: namespace || undefined }),
        onSuccess: async ({ token }) => { setCreatedToken(token); setName(''); setNamespace(''); await queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens }) }
    })
    const revokeMutation = useMutation({ mutationFn: (id: number) => api.revokeApiToken(id), onSuccess: async () => queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens }) })

    return (
        <Card>
            <CardHeader>
                <CardTitle>我的 API Token</CardTitle>
                <CardDescription>给其它机器 runner 使用。明文只会在创建时显示一次。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <form className="grid gap-2 md:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); createMutation.mutate() }}>
                    <input className={inputClass()} placeholder="名称(如 laptop)" value={name} onChange={(e) => setName(e.target.value)} />
                    <input className={inputClass()} placeholder="namespace(默认账号 namespace)" value={namespace} onChange={(e) => setNamespace(e.target.value)} />
                    <Button type="submit" disabled={createMutation.isPending}>创建 Token</Button>
                </form>
                {createdToken?.token && (
                    <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm">
                        <div className="font-medium">请立即复制保存：</div>
                        <code className="mt-2 block break-all rounded bg-[var(--app-bg)] p-2">{createdToken.token}</code>
                    </div>
                )}
                {(tokensQuery.data ?? []).map((token) => (
                    <div key={token.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--app-border)] p-3">
                        <div>
                            <div className="font-medium">{token.name || `token-${token.id}`}</div>
                            <div className="text-xs text-[var(--app-hint)]">namespace: {token.namespace} · last used: {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : 'never'}</div>
                        </div>
                        <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                                if (window.confirm('确认吊销这个 Token？')) {
                                    revokeMutation.mutate(token.id)
                                }
                            }}
                        >吊销</Button>
                    </div>
                ))}
            </CardContent>
        </Card>
    )
}

function MachineGrantsSection() {
    const { api } = useAppContext()
    const machines = useMachines(api, true)
    const online = machines.machines
    const [selectedId, setSelectedId] = useState('')
    const selected = useMemo(() => online.find((m) => m.id === selectedId) ?? online[0] ?? null, [online, selectedId])

    return (
        <Card>
            <CardHeader>
                <CardTitle>机器授权</CardTitle>
                <CardDescription>将你拥有的机器共享给其他用户，viewer 只读，operator 可操作。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <select className={inputClass()} value={selected?.id ?? ''} onChange={(e) => setSelectedId(e.target.value)}>
                    {online.map((m: Machine) => (
                        <option key={m.id} value={m.id}>{m.metadata?.displayName || m.metadata?.host || m.id}</option>
                    ))}
                </select>
                {selected ? <GrantEditor machine={selected} /> : <div className="text-sm text-[var(--app-hint)]">暂无可管理的在线机器。</div>}
            </CardContent>
        </Card>
    )
}

function GrantEditor(props: { machine: Machine }) {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const [username, setUsername] = useState('')
    const [role, setRole] = useState<'viewer' | 'operator'>('viewer')
    const [error, setError] = useState<string | null>(null)
    const key = queryKeys.resourceGrants('machine', props.machine.id)
    const grantsQuery = useQuery({ queryKey: key, queryFn: async () => (await api.listResourceGrants('machine', props.machine.id)).grants })
    const grantMutation = useMutation({
        mutationFn: () => api.createResourceGrant({ resourceType: 'machine', resourceId: props.machine.id, granteeUsername: username.trim(), role }),
        onSuccess: async () => { setUsername(''); setRole('viewer'); setError(null); await queryClient.invalidateQueries({ queryKey: key }) },
        onError: (e) => setError(e instanceof Error ? e.message : '授权失败')
    })
    const deleteMutation = useMutation({ mutationFn: (granteeAccountId: number) => api.deleteResourceGrant({ resourceType: 'machine', resourceId: props.machine.id, granteeAccountId }), onSuccess: async () => queryClient.invalidateQueries({ queryKey: key }) })

    return (
        <div className="space-y-3">
            <form className="grid gap-2 md:grid-cols-[1fr_150px_auto]" onSubmit={(e) => { e.preventDefault(); grantMutation.mutate() }}>
                <input className={inputClass()} placeholder="被授权用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
                <select className={inputClass()} value={role} onChange={(e) => setRole(e.target.value as 'viewer' | 'operator')}>
                    <option value="viewer">viewer</option>
                    <option value="operator">operator</option>
                </select>
                <Button type="submit" disabled={!username.trim() || grantMutation.isPending}>授权</Button>
            </form>
            {error && <div className="text-sm text-red-500">{error}</div>}
            {(grantsQuery.data ?? []).map((grant: ResourceGrantSummary) => (
                <div key={grant.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--app-border)] p-3">
                    <div>
                        <div className="font-medium">{grant.granteeUsername || `#${grant.granteeAccountId}`}</div>
                        <div className="text-xs text-[var(--app-hint)]">role: {grant.role}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => deleteMutation.mutate(grant.granteeAccountId)}>移除</Button>
                </div>
            ))}
        </div>
    )
}
