import type { MachineUsageState, UsageSnapshot } from '@hapi/protocol/schemas'
import { logger } from '@/ui/logger'
import { listUsageProviderAdapters } from './registry'
import type { UsageProvider } from './types'

const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60_000

type UsagePublisher = (state: MachineUsageState) => Promise<void>

export class RunnerUsageMonitor {
    private reachableProviders: readonly UsageProvider[] | null = null
    private discoveryPromise: Promise<readonly UsageProvider[]> | null = null
    private snapshots = new Map<string, UsageSnapshot>()
    private publisher: UsagePublisher | null = null
    private refreshTimer: ReturnType<typeof setInterval> | null = null
    private refreshPromise: Promise<void> | null = null

    constructor(
        private readonly refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
        private readonly providers: readonly UsageProvider[] = listUsageProviderAdapters()
    ) {}

    async connect(publish: UsagePublisher): Promise<void> {
        this.publisher = publish
        const providers = await this.discoverOnce()
        await this.refresh()
        if (providers.length > 0 && !this.refreshTimer) {
            this.refreshTimer = setInterval(() => {
                void this.refresh()
            }, this.refreshIntervalMs)
        }
    }

    disconnect(): void {
        this.publisher = null
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer)
            this.refreshTimer = null
        }
    }

    private async discoverOnce(): Promise<readonly UsageProvider[]> {
        if (this.reachableProviders) return this.reachableProviders
        if (!this.discoveryPromise) {
            this.discoveryPromise = Promise.all(
                this.providers.map(async (provider) => ({ provider, inspection: await provider.inspect() }))
            ).then((results) => {
                this.reachableProviders = results
                    .filter(({ inspection }) => inspection.available)
                    .map(({ provider }) => provider)
                return this.reachableProviders
            })
        }
        return await this.discoveryPromise
    }

    private async refresh(): Promise<void> {
        if (this.refreshPromise) return await this.refreshPromise
        const providers = this.reachableProviders
        const publisher = this.publisher
        if (!providers || !publisher) return

        this.refreshPromise = (async () => {
            const results = await Promise.allSettled(providers.map((provider) => provider.query({})))
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    this.snapshots.set(providers[index].id, result.value)
                } else {
                    logger.debug(`[usage] ${providers[index].id} refresh failed`, result.reason)
                }
            })
            await publisher({
                providers: providers.map((provider) => ({ id: provider.id, name: provider.name })),
                snapshots: providers.flatMap((provider) => {
                    const snapshot = this.snapshots.get(provider.id)
                    return snapshot ? [snapshot] : []
                }),
                refreshedAt: new Date().toISOString()
            })
        })().finally(() => {
            this.refreshPromise = null
        })
        return await this.refreshPromise
    }
}
