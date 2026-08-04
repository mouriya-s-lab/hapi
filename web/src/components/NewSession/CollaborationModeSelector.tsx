import { getCodexCollaborationModeOptions, type CodexCollaborationMode } from '@hapi/protocol'
import { useTranslation } from '@/lib/use-translation'
import type { AgentType } from './types'
import { SelectControl } from '@/components/ui/select-control'

export function CollaborationModeSelector(props: {
    agent: AgentType
    value: CodexCollaborationMode
    isDisabled: boolean
    onChange: (value: CodexCollaborationMode) => void
}) {
    const { t } = useTranslation()

    if (props.agent !== 'codex') {
        return null
    }

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.collaborationMode')}{' '}
                <span className="font-normal">({t('newSession.model.optional')})</span>
            </label>
            <SelectControl
                value={props.value}
                onChange={(e) => props.onChange(e.target.value as CodexCollaborationMode)}
                disabled={props.isDisabled}
                className="py-2 pl-3 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
            >
                {getCodexCollaborationModeOptions().map((option) => (
                    <option key={option.mode} value={option.mode}>
                        {option.label}
                    </option>
                ))}
            </SelectControl>
        </div>
    )
}
