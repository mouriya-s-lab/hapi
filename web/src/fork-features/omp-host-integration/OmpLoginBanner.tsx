import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { Button } from '@/components/ui/button'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'

export function OmpLoginBanner(props: {
    api: ApiClient
    sessionId: string
    enabled: boolean
}) {
    const { t } = useTranslation()
    const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
    const [selectedProviderId, setSelectedProviderId] = useState('')
    const [loginError, setLoginError] = useState<string | null>(null)
    const query = useQuery({
        queryKey: queryKeys.sessionOmpLoginProviders(props.sessionId),
        queryFn: async () => await props.api.getSessionOmpLoginProviders(props.sessionId),
        enabled: props.enabled,
        staleTime: 10_000,
        retry: 2
    })

    if (!props.enabled) return null
    const providers = query.data?.success ? query.data.providers : []
    const available = providers.filter((provider) => provider.available)
    if (available.length === 0 && !query.error && (!query.data || query.data.success)) return null

    const unauthenticated = available.filter((provider) => !provider.authenticated)
    const authenticated = available.filter((provider) => provider.authenticated)
    const selectedProvider = unauthenticated.find((provider) => provider.id === selectedProviderId)
    const error = loginError
        ?? (query.data && !query.data.success ? query.data.error : null)
        ?? (query.error instanceof Error ? query.error.message : null)

    const startLogin = async (providerId: string) => {
        if (activeProviderId) return
        setLoginError(null)
        setActiveProviderId(providerId)
        try {
            const result = await props.api.startSessionOmpLogin(props.sessionId, providerId)
            if (!result.success) throw new Error(result.error ?? 'OMP login failed')
            await query.refetch()
        } catch (cause) {
            setLoginError(cause instanceof Error ? cause.message : String(cause))
        } finally {
            setActiveProviderId(null)
        }
    }

    return (
        <section
            className="border-b border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 py-2"
            aria-label={t('omp.login.title')}
            data-testid="omp-login-banner"
        >
            <div className="mx-auto flex w-full max-w-content flex-wrap items-center gap-3 text-xs">
                <div className="min-w-0 flex-1">
                    <div className="font-medium text-[var(--app-fg)]">{t('omp.login.title')}</div>
                    <div className="text-[var(--app-hint)]">{t('omp.login.description')}</div>
                    {activeProviderId ? (
                        <div className="mt-1 text-[var(--app-hint)]" role="status">
                            {t('omp.login.pending')}
                        </div>
                    ) : null}
                    {authenticated.length > 0 ? (
                        <div className="mt-1 text-emerald-600 dark:text-emerald-400">
                            {t('omp.login.authenticated', {
                                providers: authenticated.map((provider) => provider.name).join(', ')
                            })}
                        </div>
                    ) : null}
                    {error ? (
                        <div className="mt-1 text-red-600" role="alert">
                            {t('omp.login.error', { message: error })}
                        </div>
                    ) : null}
                </div>
                {unauthenticated.length > 0 ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <select
                            value={selectedProvider?.id ?? ''}
                            disabled={activeProviderId !== null || query.data?.loginInProgress === true}
                            aria-label={t('omp.login.provider')}
                            className="h-8 min-w-0 max-w-72 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 text-xs text-[var(--app-fg)] disabled:opacity-50"
                            onChange={(event) => setSelectedProviderId(event.target.value)}
                        >
                            <option value="">{t('omp.login.provider')}</option>
                            {unauthenticated.map((provider) => (
                                <option key={provider.id} value={provider.id}>{provider.name}</option>
                            ))}
                        </select>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!selectedProvider || activeProviderId !== null || query.data?.loginInProgress === true}
                            aria-label={selectedProvider
                                ? t('omp.login.action', { provider: selectedProvider.name })
                                : t('omp.login.submit')}
                            onClick={() => selectedProvider && void startLogin(selectedProvider.id)}
                        >
                            {t('omp.login.submit')}
                        </Button>
                    </div>
                ) : null}
            </div>
        </section>
    )
}
