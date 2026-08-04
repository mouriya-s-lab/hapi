import { useQuery } from '@tanstack/react-query';
import type { OmpModelSummary, OmpModelsResponse } from '@hapi/protocol/apiTypes';
import type { ApiClient } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';

export function useOmpModelsForCwd(args: {
    api: ApiClient | null;
    machineId?: string | null;
    cwd?: string | null;
    enabled?: boolean;
}): {
    availableModels: OmpModelSummary[];
    currentModel: { provider: string; modelId: string } | null;
    isLoading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
} {
    const cwd = args.cwd?.trim() ?? '';
    const enabled = Boolean(args.enabled && args.api && args.machineId && cwd);
    const query = useQuery({
        queryKey: args.machineId && cwd
            ? queryKeys.machineOmpModelsForCwd(args.machineId, cwd)
            : ['machine-omp-models', 'unknown', 'unknown'] as const,
        queryFn: async (): Promise<OmpModelsResponse> => {
            if (!args.api || !args.machineId || !cwd) throw new Error('OMP model target unavailable');
            return await args.api.getMachineOmpModelsForCwd(args.machineId, cwd);
        },
        enabled,
        staleTime: 30_000,
        retry: 2
    });

    return {
        availableModels: query.data?.availableModels ?? [],
        currentModel: query.data?.currentModel ?? null,
        isLoading: query.isLoading,
        error: query.data?.success === false
            ? query.data.error ?? 'Failed to load OMP models'
            : query.error instanceof Error ? query.error.message : null,
        refetch: async () => {
            await query.refetch();
        }
    };
}
