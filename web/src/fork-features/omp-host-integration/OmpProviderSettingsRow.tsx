import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OmpLoginFlow } from '@hapi/protocol/apiTypes';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { SettingsLinkRow } from '@/components/settings/SettingsPrimitives';
import { useMachines } from '@/hooks/queries/useMachines';
import { useAppContext } from '@/lib/app-context';
import { queryKeys } from '@/lib/query-keys';
import { useTranslation } from '@/lib/use-translation';

function isActiveFlow(flow: OmpLoginFlow | null | undefined): boolean {
    return flow?.status === 'waiting_for_callback'
        || flow?.status === 'waiting_for_input'
        || flow?.status === 'authenticating';
}

export function OmpProviderSettingsRow() {
    const { api } = useAppContext();
    const { machines } = useMachines(api, true);
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [machineId, setMachineId] = useState('');
    const [loginError, setLoginError] = useState<string | null>(null);
    const [inputValue, setInputValue] = useState('');

    useEffect(() => {
        if (machines.some((machine) => machine.id === machineId)) return;
        setMachineId(machines.find((machine) => machine.active)?.id ?? machines[0]?.id ?? '');
    }, [machineId, machines]);

    const query = useQuery({
        queryKey: machineId
            ? queryKeys.machineOmpLoginProviders(machineId)
            : ['machine-omp-login-providers', 'unknown'] as const,
        queryFn: async () => await api.getMachineOmpLoginProviders(machineId),
        enabled: Boolean(machineId),
        staleTime: 10_000,
        refetchInterval: (state) => (
            state.state.data?.success === true && isActiveFlow(state.state.data.flow) ? 1_000 : false
        )
    });
    const providers = useMemo(() => (
        query.data?.success === true
            ? [...query.data.providers].sort((left, right) => (
                Number(right.authenticated) - Number(left.authenticated) || left.name.localeCompare(right.name)
            ))
            : []
    ), [query.data]);
    const flow = query.data?.success === true ? query.data.flow : null;
    const authenticatedCount = providers.filter((provider) => provider.authenticated).length;
    const authenticatedProviderSignature = `${machineId}:${providers
        .filter((provider) => provider.authenticated)
        .map((provider) => provider.id)
        .join(',')}`;
    const previousAuthenticatedProviderSignature = useRef<string | null>(null);
    const queryError = query.data?.success === false
        ? query.data.error
        : query.error instanceof Error ? query.error.message : null;

    useEffect(() => {
        if (query.data?.success !== true) return;
        if (previousAuthenticatedProviderSignature.current === authenticatedProviderSignature) return;
        previousAuthenticatedProviderSignature.current = authenticatedProviderSignature;
        void queryClient.invalidateQueries({ queryKey: ['machine-omp-models'] });
    }, [authenticatedProviderSignature, query.data?.success, queryClient]);

    const startLogin = async (providerId: string) => {
        setLoginError(null);
        const popup = window.open('about:blank', '_blank');
        if (popup) popup.opener = null;
        try {
            const result = await api.startMachineOmpLogin(machineId, providerId);
            if (!result.success) throw new Error(result.error);
            if (result.flow.status === 'waiting_for_callback') {
                const target = result.flow.launchUrl ?? result.flow.url;
                if (popup) {
                    popup.location.replace(target);
                } else {
                    setLoginError(t('settings.fork.omp.popupBlocked'));
                }
            } else {
                popup?.close();
            }
            await query.refetch();
        } catch (error) {
            popup?.close();
            setLoginError(error instanceof Error ? error.message : String(error));
        }
    };

    const submitInput = async () => {
        if (!flow || flow.status !== 'waiting_for_input' || !inputValue) return;
        setLoginError(null);
        try {
            const result = await api.respondMachineOmpLoginInput(machineId, flow.flowId, inputValue);
            if (!result.success) throw new Error(result.error);
            setInputValue('');
            await query.refetch();
        } catch (error) {
            setLoginError(error instanceof Error ? error.message : String(error));
        }
    };

    return (
        <>
            <SettingsLinkRow
                label={t('settings.fork.omp.title')}
                description={t('settings.fork.omp.description')}
                value={machineId && query.isLoading
                    ? t('settings.fork.omp.loading')
                    : t('settings.fork.omp.signedInCount', { count: authenticatedCount })}
                onClick={() => setOpen(true)}
            />
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{t('settings.fork.omp.title')}</DialogTitle>
                    </DialogHeader>
                    <div className="mt-4 flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
                        <label className="flex flex-col gap-1.5 text-sm text-[var(--app-fg)]">
                            {t('settings.fork.omp.machine')}
                            <select
                                value={machineId}
                                onChange={(event) => {
                                    setMachineId(event.target.value);
                                    setLoginError(null);
                                    setInputValue('');
                                }}
                                className="h-9 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 text-sm text-[var(--app-fg)]"
                            >
                                <option value="">{t('settings.fork.omp.machineRequired')}</option>
                                {machines.map((machine) => (
                                    <option key={machine.id} value={machine.id}>
                                        {machine.metadata?.host ?? machine.id}
                                    </option>
                                ))}
                            </select>
                        </label>

                        {flow?.status === 'waiting_for_callback' ? (
                            <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-3 text-sm">
                                <div className="font-medium text-[var(--app-fg)]">
                                    {t('settings.fork.omp.waitingForCallback', { provider: flow.providerName })}
                                </div>
                                {flow.instructions ? <p className="mt-1 text-[var(--app-hint)]">{flow.instructions}</p> : null}
                                <a
                                    href={flow.launchUrl ?? flow.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-2 inline-block text-[var(--app-link)] hover:underline"
                                >
                                    {t('settings.fork.omp.openLoginPage')}
                                </a>
                            </div>
                        ) : null}
                        {flow?.status === 'waiting_for_input' ? (
                            <form
                                className="rounded-lg border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-3"
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    void submitInput();
                                }}
                            >
                                <label className="flex flex-col gap-2 text-sm text-[var(--app-fg)]">
                                    {flow.title}
                                    <input
                                        value={inputValue}
                                        placeholder={flow.placeholder}
                                        onChange={(event) => setInputValue(event.target.value)}
                                        className="h-9 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 text-sm text-[var(--app-fg)]"
                                    />
                                </label>
                                <Button type="submit" className="mt-3" disabled={!inputValue}>
                                    {t('settings.fork.omp.submitInput')}
                                </Button>
                            </form>
                        ) : null}
                        {flow?.status === 'authenticating' ? (
                            <div className="text-sm text-[var(--app-hint)]" role="status">
                                {t('settings.fork.omp.authenticating', { provider: flow.providerName })}
                            </div>
                        ) : null}
                        {flow?.status === 'authenticated' ? (
                            <div className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
                                {t('settings.fork.omp.authenticated', { provider: flow.providerName })}
                            </div>
                        ) : null}
                        {flow?.status === 'failed' ? (
                            <div className="text-sm text-red-600" role="alert">{flow.error}</div>
                        ) : null}
                        {loginError || queryError ? (
                            <div className="text-sm text-red-600" role="alert">{loginError ?? queryError}</div>
                        ) : null}

                        <div className="divide-y divide-[var(--app-divider)] overflow-hidden rounded-xl border border-[var(--app-border)]">
                            {providers.map((provider) => (
                                <div key={provider.id} className="flex items-center justify-between gap-3 px-3 py-3">
                                    <div className="min-w-0">
                                        <div className="text-sm text-[var(--app-fg)]">{provider.name}</div>
                                        <div className="truncate text-xs text-[var(--app-hint)]">{provider.id}</div>
                                    </div>
                                    {provider.authenticated ? (
                                        <span className="shrink-0 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                            {t('settings.fork.omp.signedIn')}
                                        </span>
                                    ) : (
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            disabled={!provider.available || isActiveFlow(flow)}
                                            onClick={() => void startLogin(provider.id)}
                                        >
                                            {t('settings.fork.omp.signIn')}
                                        </Button>
                                    )}
                                </div>
                            ))}
                            {!query.isLoading && providers.length === 0 ? (
                                <div className="px-3 py-6 text-center text-sm text-[var(--app-hint)]">
                                    {t('settings.fork.omp.noProviders')}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
