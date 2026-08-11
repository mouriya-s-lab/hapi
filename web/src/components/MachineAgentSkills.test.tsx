import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MachineAgentSkills } from '@hapi/protocol/schemas'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { MachineAgentSkillsRow } from './MachineAgentSkills'

function report(status: 'current' | 'outdated', checkedAt: number): MachineAgentSkills {
    return {
        canonicalHash: 'canonical-hash',
        cliVersion: '1.0.0',
        checkedAt,
        harnesses: { claude: { status } }
    }
}

function machine(agentSkills: MachineAgentSkills, active = true): Machine {
    return {
        id: 'machine-1',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active,
        activeAt: 1,
        metadata: { host: 'runner.local', agentSkills },
        runnerState: { status: active ? 'running' : 'stopped' }
    } as Machine
}

function renderRow(api: ApiClient, value: Machine) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <MachineAgentSkillsRow api={api} machine={value} />
            </I18nProvider>
        </QueryClientProvider>
    )
}

afterEach(() => cleanup())

describe('MachineAgentSkillsRow', () => {
    it('shows a fresh probe immediately and yields to newer machine metadata', async () => {
        const refreshMachineAgentSkills = vi.fn(async () => ({ agentSkills: report('outdated', 2) }))
        const api = { refreshMachineAgentSkills } as unknown as ApiClient
        const view = renderRow(api, machine(report('current', 1)))

        expect(screen.getByText('ready')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

        await waitFor(() => expect(screen.getByText('outdated')).toBeInTheDocument())
        expect(refreshMachineAgentSkills).toHaveBeenCalledWith('machine-1')

        view.rerender(
            <QueryClientProvider client={new QueryClient()}>
                <I18nProvider>
                    <MachineAgentSkillsRow api={api} machine={machine(report('current', 3))} />
                </I18nProvider>
            </QueryClientProvider>
        )
        expect(screen.getByText('ready')).toBeInTheDocument()
    })

    it('marks reports offline and disables refresh when the runner is unavailable', () => {
        const api = { refreshMachineAgentSkills: vi.fn() } as unknown as ApiClient
        renderRow(api, machine(report('current', 1), false))

        expect(screen.getByText('offline')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    })
})
