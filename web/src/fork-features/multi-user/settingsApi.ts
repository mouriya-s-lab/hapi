import { useCallback } from 'react'
import { useAppContext } from '@/lib/app-context'

export type Account = { id: number; username: string; role: 'admin' | 'user'; defaultNamespace: string; disabledAt: number | null; memory: string | null }
export type ApiToken = { id: number; name: string | null; createdAt: number }
export type Machine = { id: string; metadata?: { displayName?: string; host?: string } }
export type Grant = { accountId: number; role: 'viewer' | 'operator' }
export const settingsInputClass = 'w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50'

export function useSettingsRequest() {
    const { baseUrl, token } = useAppContext()
    return useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
        const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init?.headers } })
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `HTTP ${response.status}`)
        return response.json()
    }, [baseUrl, token])
}
