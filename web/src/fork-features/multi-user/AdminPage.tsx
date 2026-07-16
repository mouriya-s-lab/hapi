import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Account = { id: number; username: string; role: 'admin' | 'user'; defaultNamespace: string; disabledAt: number | null }
type Token = { id: number; name: string | null; createdAt: number }
type Machine = { id: string; metadata?: { displayName?: string; host?: string } }
type Grant = { accountId: number; role: 'viewer' | 'operator' }
type Request = <T>(path: string, init?: RequestInit) => Promise<T>

const inputClass = 'w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-2 focus:ring-[var(--app-button)] disabled:opacity-50'

export default function AdminPage() {
    const { token, baseUrl, user } = useAppContext()
    const navigate = useNavigate()
    const [accounts, setAccounts] = useState<Account[]>([])
    const [tokens, setTokens] = useState<Token[]>([])
    const [machines, setMachines] = useState<Machine[]>([])
    const [createdToken, setCreatedToken] = useState<string | null>(null)
    const [createOpen, setCreateOpen] = useState(false)
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState<'admin' | 'user'>('user')
    const [tokenName, setTokenName] = useState('')
    const [error, setError] = useState<string | null>(null)

    const request = useCallback<Request>(async (path, init) => {
        const response = await fetch(`${baseUrl}${path}`, {
            ...init,
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init?.headers }
        })
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `HTTP ${response.status}`)
        return await response.json()
    }, [baseUrl, token])

    const refresh = useCallback(async () => {
        setError(null)
        try {
            const [tokenResult, machineResult] = await Promise.all([
                request<{ tokens: Token[] }>('/api/tokens'), request<{ machines: Machine[] }>('/api/machines')
            ])
            setTokens(tokenResult.tokens)
            setMachines(machineResult.machines)
            if (user.role === 'admin') setAccounts((await request<{ accounts: Account[] }>('/api/accounts')).accounts)
        } catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败') }
    }, [request, user.role])

    useEffect(() => { void refresh() }, [refresh])

    const updateAccount = async (id: number, body: object) => {
        await request(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); await refresh()
    }

    const createAccount = async (event: React.FormEvent) => {
        event.preventDefault()
        await request('/api/accounts', { method: 'POST', body: JSON.stringify({ username, password, role }) })
        setCreateOpen(false); setUsername(''); setPassword(''); setRole('user'); await refresh()
    }

    const createToken = async (event: React.FormEvent) => {
        event.preventDefault()
        const result = await request<{ plaintext: string }>('/api/tokens', { method: 'POST', body: JSON.stringify({ name: tokenName || null }) })
        setCreatedToken(result.plaintext); setTokenName(''); await refresh()
    }

    return <div className="h-full min-h-0 overflow-y-auto bg-[var(--app-bg)] text-[var(--app-fg)]">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-4 py-3">
            <div><div className="font-semibold">管理面板</div><div className="text-xs text-[var(--app-hint)]">用户、API Token 与机器授权</div></div>
            <Button variant="outline" size="sm" onClick={() => navigate({ to: '/sessions' })}>返回</Button>
        </header>
        <main className="mx-auto max-w-5xl space-y-4 p-4">
            {error && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-500">{error}</div>}
            {user.role !== 'admin' && <Card><CardHeader><CardTitle>仅管理员可管理用户</CardTitle><CardDescription>你仍可管理自己的 API Token。</CardDescription></CardHeader></Card>}
            {user.role === 'admin' && <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3"><div><CardTitle>用户</CardTitle><CardDescription>创建账号、设置角色、密码和禁用状态。</CardDescription></div><Button size="sm" onClick={() => setCreateOpen(true)}>新建用户</Button></CardHeader>
                <CardContent className="space-y-2">{accounts.map(account => <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--app-border)] p-3"><div><div className="flex items-center gap-2"><b>{account.username}</b><Badge variant={account.role === 'admin' ? 'success' : 'default'}>{account.role}</Badge>{account.disabledAt && <Badge variant="destructive">disabled</Badge>}</div><div className="text-xs text-[var(--app-hint)]">namespace: {account.defaultNamespace}</div></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => updateAccount(account.id, { role: account.role === 'admin' ? 'user' : 'admin' })}>{account.role === 'admin' ? '降为用户' : '升为管理员'}</Button><Button size="sm" variant="outline" onClick={async () => { const next = window.prompt(`为 ${account.username} 设置新密码（至少 8 位）`); if (next && next.length >= 8) await updateAccount(account.id, { password: next }) }}>设密码</Button><Button size="sm" variant="outline" onClick={() => updateAccount(account.id, { disabled: !account.disabledAt })}>{account.disabledAt ? '启用' : '禁用'}</Button><Button size="sm" variant="destructive" disabled={account.id === user.id} onClick={async () => { if (window.confirm(`确定删除 ${account.username}？`)) { await request(`/api/accounts/${account.id}`, { method: 'DELETE' }); await refresh() } }}>删除</Button></div></div>)}</CardContent>
                <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>新建用户</DialogTitle></DialogHeader><form className="mt-4 space-y-3" onSubmit={createAccount}><input className={inputClass} placeholder="用户名" value={username} onChange={e => setUsername(e.target.value)} /><input className={inputClass} type="password" placeholder="密码（至少 8 位）" value={password} onChange={e => setPassword(e.target.value)} /><select className={inputClass} value={role} onChange={e => setRole(e.target.value as 'admin' | 'user')}><option value="user">普通用户</option><option value="admin">管理员</option></select><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button disabled={!username.trim() || password.length < 8}>创建</Button></div></form></DialogContent></Dialog>
            </Card>}
            <Card><CardHeader><CardTitle>我的 API Token</CardTitle><CardDescription>给 runner 使用；固定映射到账号 namespace，明文只在创建时显示一次。</CardDescription></CardHeader><CardContent className="space-y-3"><form className="grid gap-2 md:grid-cols-[1fr_1fr_auto]" onSubmit={createToken}><input className={inputClass} placeholder="名称（如 laptop）" value={tokenName} onChange={e => setTokenName(e.target.value)} /><input className={inputClass} value={user.defaultNamespace} disabled aria-label="Token namespace" /><Button>创建 Token</Button></form>{createdToken && <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm"><div className="font-medium">请立即复制保存：</div><code className="mt-2 block break-all rounded bg-[var(--app-bg)] p-2">{createdToken}</code></div>}{tokens.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--app-border)] p-3"><div><div className="font-medium">{item.name || `token-${item.id}`}</div><div className="text-xs text-[var(--app-hint)]">namespace: {user.defaultNamespace}</div></div><Button size="sm" variant="destructive" onClick={async () => { if (window.confirm('确认吊销这个 Token？')) { await request(`/api/tokens/${item.id}`, { method: 'DELETE' }); await refresh() } }}>吊销</Button></div>)}</CardContent></Card>
            <MachineGrants machines={machines} accounts={accounts} request={request} />
        </main>
    </div>
}

function MachineGrants(props: { machines: Machine[]; accounts: Account[]; request: Request }) {
    const [selectedId, setSelectedId] = useState('')
    const selected = useMemo(() => props.machines.find(machine => machine.id === selectedId) ?? props.machines[0] ?? null, [props.machines, selectedId])
    return <Card><CardHeader><CardTitle>机器授权</CardTitle><CardDescription>将你拥有的机器共享给其他用户；viewer 只读，operator 可操作。</CardDescription></CardHeader><CardContent className="space-y-3"><select className={inputClass} value={selected?.id ?? ''} onChange={e => setSelectedId(e.target.value)}>{props.machines.map(machine => <option key={machine.id} value={machine.id}>{machine.metadata?.displayName ?? machine.metadata?.host ?? machine.id}</option>)}</select>{selected ? <GrantEditor machine={selected} accounts={props.accounts} request={props.request} /> : <div className="text-sm text-[var(--app-hint)]">暂无可管理的在线机器。</div>}</CardContent></Card>
}

function GrantEditor(props: { machine: Machine; accounts: Account[]; request: Request }) {
    const [accountId, setAccountId] = useState('')
    const [role, setRole] = useState<'viewer' | 'operator'>('viewer')
    const [grants, setGrants] = useState<Grant[]>([])
    const [error, setError] = useState<string | null>(null)
    const refresh = useCallback(async () => { try { setGrants((await props.request<{ grants: Grant[] }>(`/api/grants/machine/${encodeURIComponent(props.machine.id)}`)).grants); setError(null) } catch (cause) { setError(cause instanceof Error ? cause.message : '加载授权失败') } }, [props.machine.id, props.request])
    useEffect(() => { void refresh() }, [refresh])
    const grant = async (event: React.FormEvent) => { event.preventDefault(); await props.request(`/api/grants/machine/${encodeURIComponent(props.machine.id)}`, { method: 'POST', body: JSON.stringify({ accountId: Number(accountId), role }) }); setAccountId(''); setRole('viewer'); await refresh() }
    return <div className="space-y-3"><form className="grid gap-2 md:grid-cols-[1fr_150px_auto]" onSubmit={grant}><select className={inputClass} value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">选择用户</option>{props.accounts.map(account => <option key={account.id} value={account.id}>{account.username}</option>)}</select><select className={inputClass} value={role} onChange={e => setRole(e.target.value as 'viewer' | 'operator')}><option value="viewer">viewer</option><option value="operator">operator</option></select><Button disabled={!accountId}>授权</Button></form>{error && <div className="text-sm text-red-500">{error}</div>}{grants.map(item => <div key={item.accountId} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--app-border)] p-3"><div><div className="font-medium">{props.accounts.find(account => account.id === item.accountId)?.username ?? `#${item.accountId}`}</div><div className="text-xs text-[var(--app-hint)]">role: {item.role}</div></div><Button size="sm" variant="outline" onClick={async () => { await props.request(`/api/grants/machine/${encodeURIComponent(props.machine.id)}/${item.accountId}`, { method: 'DELETE' }); await refresh() }}>移除</Button></div>)}</div>
}
