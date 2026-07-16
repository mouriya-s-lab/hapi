import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { Button } from '@/components/ui/button'

type Account = { id: number; username: string; role: 'admin' | 'user'; defaultNamespace: string; disabledAt: number | null }
type Token = { id: number; name: string | null; createdAt: number }
type Machine = { id: string; metadata?: { displayName?: string; host?: string } }

const inputClass = 'w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-[var(--app-fg)]'
const panelClass = 'rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] p-4'

export default function AdminPage() {
    const { token, baseUrl, user } = useAppContext()
    const navigate = useNavigate()
    const [accounts, setAccounts] = useState<Account[]>([])
    const [tokens, setTokens] = useState<Token[]>([])
    const [machines, setMachines] = useState<Machine[]>([])
    const [createdToken, setCreatedToken] = useState<string | null>(null)
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [tokenName, setTokenName] = useState('')
    const [error, setError] = useState<string | null>(null)

    const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
        const response = await fetch(`${baseUrl}${path}`, {
            ...init,
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init?.headers }
        })
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `HTTP ${response.status}`)
        return await response.json() as T
    }, [baseUrl, token])

    const refresh = useCallback(async () => {
        setError(null)
        try {
            const [tokenResult, machineResult] = await Promise.all([
                request<{ tokens: Token[] }>('/api/tokens'),
                request<{ machines: Machine[] }>('/api/machines')
            ])
            setTokens(tokenResult.tokens)
            setMachines(machineResult.machines)
            if (user.role === 'admin') setAccounts((await request<{ accounts: Account[] }>('/api/accounts')).accounts)
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '加载失败')
        }
    }, [request, user.role])

    useEffect(() => { void refresh() }, [refresh])

    const createAccount = async (event: React.FormEvent) => {
        event.preventDefault()
        await request('/api/accounts', { method: 'POST', body: JSON.stringify({ username, password, role: 'user' }) })
        setUsername(''); setPassword(''); await refresh()
    }

    const updateAccount = async (id: number, body: object) => {
        await request(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); await refresh()
    }

    const createToken = async (event: React.FormEvent) => {
        event.preventDefault()
        const result = await request<{ plaintext: string }>('/api/tokens', { method: 'POST', body: JSON.stringify({ name: tokenName || null }) })
        setCreatedToken(result.plaintext); setTokenName(''); await refresh()
    }

    return <div className="h-full overflow-y-auto bg-[var(--app-bg)] text-[var(--app-fg)]">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-4 py-3">
            <div><div className="font-semibold">管理面板</div><div className="text-xs text-[var(--app-hint)]">用户、API Token 与机器授权</div></div>
            <Button variant="outline" size="sm" onClick={() => navigate({ to: '/sessions' })}>返回</Button>
        </header>
        <main className="mx-auto max-w-5xl space-y-4 p-4">
            {error && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-500">{error}</div>}
            {user.role !== 'admin' && <section className={panelClass}><h2 className="font-semibold">仅管理员可管理用户</h2><p className="text-sm text-[var(--app-hint)]">你仍可管理自己的 API Token。</p></section>}
            {user.role === 'admin' && <section className={panelClass}>
                <h2 className="mb-1 font-semibold">用户</h2><p className="mb-3 text-sm text-[var(--app-hint)]">创建账号、设置角色、密码和禁用状态。</p>
                <form onSubmit={createAccount} className="mb-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]"><input className={inputClass} placeholder="用户名" value={username} onChange={e => setUsername(e.target.value)} /><input className={inputClass} type="password" placeholder="密码（至少 8 位）" value={password} onChange={e => setPassword(e.target.value)} /><Button disabled={!username || password.length < 8}>新建用户</Button></form>
                <div className="space-y-2">{accounts.map(account => <div key={account.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--app-border)] p-3"><div><b>{account.username}</b> <span className="text-xs">{account.role}</span><div className="text-xs text-[var(--app-hint)]">namespace: {account.defaultNamespace}{account.disabledAt ? ' · disabled' : ''}</div></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => updateAccount(account.id, { role: account.role === 'admin' ? 'user' : 'admin' })}>{account.role === 'admin' ? '降为用户' : '升为管理员'}</Button><Button size="sm" variant="outline" onClick={async () => { const next = window.prompt(`为 ${account.username} 设置新密码（至少 8 位）`); if (next && next.length >= 8) await updateAccount(account.id, { password: next }) }}>设密码</Button><Button size="sm" variant="outline" onClick={() => updateAccount(account.id, { disabled: !account.disabledAt })}>{account.disabledAt ? '启用' : '禁用'}</Button><Button size="sm" variant="destructive" disabled={account.id === user.id} onClick={async () => { if (window.confirm(`确定删除 ${account.username}？`)) { await request(`/api/accounts/${account.id}`, { method: 'DELETE' }); await refresh() } }}>删除</Button></div></div>)}</div>
            </section>}
            <section className={panelClass}><h2 className="mb-1 font-semibold">我的 API Token</h2><p className="mb-3 text-sm text-[var(--app-hint)]">明文只在创建时显示一次。</p><form onSubmit={createToken} className="flex gap-2"><input className={inputClass} placeholder="名称（如 laptop）" value={tokenName} onChange={e => setTokenName(e.target.value)} /><Button>创建 Token</Button></form>{createdToken && <code className="mt-3 block break-all rounded-lg bg-green-500/10 p-3">{createdToken}</code>}<div className="mt-3 space-y-2">{tokens.map(item => <div key={item.id} className="flex justify-between rounded-lg border border-[var(--app-border)] p-3"><span>{item.name || `token-${item.id}`}</span><Button size="sm" variant="destructive" onClick={async () => { await request(`/api/tokens/${item.id}`, { method: 'DELETE' }); await refresh() }}>吊销</Button></div>)}</div></section>
            <section className={panelClass}><h2 className="mb-1 font-semibold">机器授权</h2><p className="mb-3 text-sm text-[var(--app-hint)]">将共享 runner 授予其他账号。</p>{machines.map(machine => <MachineGrant key={machine.id} machine={machine} accounts={accounts} request={request} />)}</section>
        </main>
    </div>
}

function MachineGrant(props: { machine: Machine; accounts: Account[]; request: <T>(path: string, init?: RequestInit) => Promise<T> }) {
    const [accountId, setAccountId] = useState('')
    return <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--app-border)] p-3"><div><b>{props.machine.metadata?.displayName ?? props.machine.metadata?.host ?? props.machine.id.slice(0, 8)}</b><div className="text-xs text-[var(--app-hint)]">{props.machine.id}</div></div><div className="flex gap-2"><select className={inputClass} value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">选择用户</option>{props.accounts.map(a => <option key={a.id} value={a.id}>{a.username}</option>)}</select><Button disabled={!accountId} onClick={() => props.request(`/api/grants/machine/${encodeURIComponent(props.machine.id)}`, { method: 'POST', body: JSON.stringify({ accountId: Number(accountId), role: 'operator' }) })}>授予 operator</Button></div></div>
}
