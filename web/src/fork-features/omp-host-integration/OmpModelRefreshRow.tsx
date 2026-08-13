import { useTranslation } from '@/lib/use-translation'

export function OmpModelRefreshRow(props: {
    refreshing: boolean
    error: string | null
    empty: boolean
    disabled: boolean
    onRefresh: () => void
}) {
    const { t } = useTranslation()
    const refreshDisabled = props.disabled || props.refreshing

    return (
        <>
            <button
                type="button"
                disabled={refreshDisabled}
                aria-label={props.refreshing ? t('misc.refreshingModels') : t('misc.refreshModels')}
                data-testid="omp-refresh-models"
                className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors ${
                    refreshDisabled
                        ? 'cursor-not-allowed opacity-50'
                        : 'cursor-pointer hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-link)]'
                }`}
                onClick={props.onRefresh}
                onMouseDown={(event) => event.preventDefault()}
            >
                {props.refreshing ? t('misc.refreshingModels') : t('misc.refreshModels')}
            </button>
            {props.error ? (
                <div className="px-3 pb-2 text-xs text-red-600" data-testid="omp-refresh-models-error">
                    {props.error}
                </div>
            ) : null}
            {!props.error && props.empty && !props.refreshing ? (
                <div className="px-3 pb-2 text-xs text-[var(--app-hint)]" data-testid="omp-refresh-models-empty">
                    {t('misc.ompModelsEmpty')}
                </div>
            ) : null}
        </>
    )
}
