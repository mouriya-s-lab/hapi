import { useNavigate } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { SettingsLinkRow, SettingsPageContent, SettingsSection } from '@/components/settings/SettingsPrimitives'
import { HistoryImportSettingsRow } from '../history-import/HistoryImportSettingsRow'

export default function ForkSettingsPage() {
    const navigate = useNavigate()
    const { user } = useAppContext()
    const { t } = useTranslation()

    return (
        <SettingsPageContent title={t('settings.fork.title')} description={t('settings.fork.description')}>
            <SettingsSection>
                <HistoryImportSettingsRow />
                <SettingsLinkRow label={t('settings.fork.account.title')} description={t('settings.fork.account.description')} onClick={() => navigate({ to: '/settings/fork/account' })} />
                {user.role === 'admin' ? (
                    <SettingsLinkRow
                        label={t('settings.fork.users.title')}
                        description={t('settings.fork.users.description')}
                        onClick={() => navigate({ to: '/settings/fork/users' })}
                    />
                ) : null}
            </SettingsSection>
        </SettingsPageContent>
    )
}
