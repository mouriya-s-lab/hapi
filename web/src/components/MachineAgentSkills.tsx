import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getFlavorLabel } from '@hapi/protocol'
import type { AgentSkillDeployStatus, MachineAgentSkills } from '@hapi/protocol/schemas'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'
import { queryKeys } from '@/lib/query-keys'
import { agentSkillMachinesQueryKey } from '@/fork-features/agent-skill-readiness/machineQuery'

type SkillBadgeTone = 'ready' | 'missing' | 'outdated' | 'conflict' | 'failed' | 'offline'

function toneFor(status: AgentSkillDeployStatus): SkillBadgeTone {
    switch (status) {
        case 'deployed':
        case 'current':
        case 'updated':
            return 'ready'
        case 'missing':
            return 'missing'
        case 'outdated':
            return 'outdated'
        case 'conflict':
            return 'conflict'
        case 'failed':
            return 'failed'
    }
}

const TONE_CLASSES: Record<SkillBadgeTone, string> = {
    ready: 'bg-green-500/10 text-green-700 dark:text-green-400',
    missing: 'bg-[var(--app-hint)]/10 text-[var(--app-hint)]',
    outdated: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
    conflict: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
    failed: 'bg-red-500/10 text-red-700 dark:text-red-400',
    offline: 'bg-[var(--app-hint)]/10 text-[var(--app-hint)]'
}

type MachineAgentSkillsRowProps = {
    api: ApiClient | null
    machine: Machine
}

export function MachineAgentSkillsRow(props: MachineAgentSkillsRowProps) {
    const { api, machine } = props
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const machineReport = machine.metadata?.agentSkills
    const [probed, setProbed] = useState<MachineAgentSkills | null>(null)
    const [refreshError, setRefreshError] = useState<string | null>(null)
    const offline = !machine.active || machine.runnerState?.status !== 'running'

    const refreshMutation = useMutation({
        mutationFn: () => {
            if (!api) throw new Error('API unavailable')
            return api.refreshMachineAgentSkills(machine.id)
        },
        onSuccess: (response) => {
            setProbed(response.agentSkills)
            setRefreshError(null)
            void queryClient.invalidateQueries({ queryKey: queryKeys.machines })
            void queryClient.invalidateQueries({ queryKey: agentSkillMachinesQueryKey })
        },
        onError: () => setRefreshError(t('settings.machines.skills.refreshError'))
    })

    const report = probed && (!machineReport || probed.checkedAt >= machineReport.checkedAt)
        ? probed
        : machineReport
    if (!report && !api) return null

    return (
        <div className="mt-1.5">
            <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[var(--app-hint)]">{t('settings.machines.skills.label')}</span>
                <button
                    type="button"
                    disabled={offline || refreshMutation.isPending}
                    onClick={() => refreshMutation.mutate()}
                    className="text-xs text-[var(--app-link)] hover:underline disabled:opacity-60"
                >
                    {refreshMutation.isPending ? t('settings.machines.skills.refreshing') : t('settings.machines.skills.refresh')}
                </button>
            </div>
            {report ? (
                <div className="mt-1 flex flex-wrap gap-1">
                    {Object.entries(report.harnesses).map(([flavor, result]) => {
                        const tone = offline ? 'offline' : toneFor(result.status)
                        const statusLabel = t(`settings.machines.skills.status.${tone}`)
                        return (
                            <span
                                key={flavor}
                                title={`${flavor}: ${offline ? 'offline' : result.status}`}
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-tight ${TONE_CLASSES[tone]}`}
                            >
                                {getFlavorLabel(flavor)}
                                <span className="opacity-80">{statusLabel}</span>
                            </span>
                        )
                    })}
                </div>
            ) : (
                <div className="mt-1 text-xs text-[var(--app-hint)]">
                    {offline ? t('settings.machines.skills.status.offline') : t('settings.machines.skills.noReport')}
                </div>
            )}
            {refreshError ? <div role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{refreshError}</div> : null}
        </div>
    )
}
