import { useTranslation } from '@/lib/use-translation'
import { SettingsPageContent, SettingsSection } from '@/components/settings/SettingsPrimitives'
import { HistoryImportSettingsRow } from '../history-import/HistoryImportSettingsRow'

export default function ForkSettingsPage() {
    const { t } = useTranslation()

    return (
        <SettingsPageContent title={t('settings.fork.title')} description={t('settings.fork.description')}>
            <SettingsSection>
                <HistoryImportSettingsRow />
            </SettingsSection>
        </SettingsPageContent>
    )
}
