import type { ForkSpawnPayload, ForkSpawnResult } from './rpcPayloads'

export type Flavor = string

export interface ForkProvider {
    spawnFork(payload: ForkSpawnPayload): Promise<ForkSpawnResult>
}

const registry = new Map<Flavor, ForkProvider>()

export function registerForkProvider(flavor: Flavor, provider: ForkProvider): void {
    registry.set(flavor, provider)
}

export function getForkProvider(flavor: Flavor): ForkProvider | undefined {
    return registry.get(flavor)
}

export function listForkCapableFlavors(): Flavor[] {
    return [...registry.keys()]
}

export function __resetRegistryForTests(): void {
    registry.clear()
}
