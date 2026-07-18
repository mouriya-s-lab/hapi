import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { SettingsLinkRow } from '@/components/settings/SettingsPrimitives'
import { useMachines } from '@/hooks/queries/useMachines'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { ImportExistingSessionsDialog } from './ImportExistingSessionsDialog'

export function HistoryImportSettingsRow() {
    const { api } = useAppContext()
    const { machines } = useMachines(api, true)
    const { t } = useTranslation()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [open, setOpen] = useState(false)

    return (
        <>
            <SettingsLinkRow
                label={t('settings.fork.import.title')}
                description={t('settings.fork.import.description')}
                onClick={() => setOpen(true)}
            />
            <ImportExistingSessionsDialog
                api={api}
                machines={machines}
                open={open}
                onOpenChange={setOpen}
                onSuccess={(sessionId) => {
                    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
                    navigate({ to: '/sessions/$sessionId', params: { sessionId } })
                }}
            />
        </>
    )
}
