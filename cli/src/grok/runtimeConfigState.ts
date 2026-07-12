export type RuntimeConfigRequest<T> =
    | { kind: 'unchanged' }
    | { kind: 'reset' }
    | { kind: 'set'; value: T };

export function parseRuntimeConfigRequest<T>(value: T | null | undefined): RuntimeConfigRequest<T> {
    if (value === undefined) return { kind: 'unchanged' };
    if (value === null) return { kind: 'reset' };
    return { kind: 'set', value };
}

export function resolveRuntimeConfigRequest<T>(
    request: RuntimeConfigRequest<T>,
    defaultValue: T | null
): T | null | undefined {
    switch (request.kind) {
        case 'unchanged':
            return undefined;
        case 'reset':
            return defaultValue;
        case 'set':
            return request.value;
    }
}

export function assertGrokRuntimeConfigOwnership(
    controlMode: 'local' | 'remote' | undefined,
    hasConfigChange: boolean
): void {
    if (controlMode === 'local' && hasConfigChange) {
        throw new Error('Grok runtime config cannot change while the local CLI controls the session');
    }
}
