import { usePlatform } from '@/hooks/usePlatform'
import { usePwaUpdateContext } from '@/lib/pwa-update-context'
import { useTranslation } from '@/lib/use-translation'

export function PwaReloadButton() {
    const { t } = useTranslation()
    const { reload } = usePwaUpdateContext()
    const { haptic } = usePlatform()

    return (
        <button
            type="button"
            onClick={() => {
                haptic.impact('light')
                reload()
            }}
            className="shrink-0 rounded-lg bg-[var(--app-fg)] px-4 py-2 text-sm font-medium text-[var(--app-bg)] active:opacity-80"
        >
            {t('pwa.update.reload')}
        </button>
    )
}
