import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { configuration } from '@/configuration';
import { OMP_KNOWN_EVENT_TYPES, type OmpKnownEventType } from './types';

export const DEFAULT_OMP_EVENT_ALLOWLIST: readonly OmpKnownEventType[] = [
    'message_end',
    'tool_execution_start',
    'tool_execution_update',
    'tool_execution_end',
    'auto_compaction_start',
    'auto_compaction_end',
    'auto_retry_start',
    'auto_retry_end',
    'retry_fallback_applied',
    'retry_fallback_succeeded',
    'notice',
    'command_output',
    'extension_error',
    'rpc_frame_error',
    'subagent_lifecycle',
    'subagent_progress',
    'subagent_event',
    'host_tool_call',
    'host_uri_request'
];

export const defaultOmpEventAllowlist: ReadonlySet<OmpKnownEventType> = new Set(DEFAULT_OMP_EVENT_ALLOWLIST);

const SettingsSchema = z.object({ ompEventAllowlist: z.unknown().optional() });
const EventTypeSchema = z.enum(OMP_KNOWN_EVENT_TYPES);

function parseAllowlist(value: unknown, source: string): ReadonlySet<OmpKnownEventType> {
    const array = z.array(z.unknown()).safeParse(value);
    if (!array.success) {
        throw new Error(`Invalid ${source}: expected an array of OMP event names`);
    }
    const allowed = new Set<OmpKnownEventType>();
    for (const [index, entry] of array.data.entries()) {
        if (typeof entry !== 'string') {
            throw new Error(`Invalid ${source}[${index}]: expected a string event name`);
        }
        const eventType = EventTypeSchema.safeParse(entry);
        if (!eventType.success) {
            throw new Error(`Invalid ${source}[${index}]: unknown OMP event name ${JSON.stringify(entry)}`);
        }
        if (allowed.has(eventType.data)) {
            throw new Error(`Invalid ${source}[${index}]: duplicate OMP event name ${JSON.stringify(entry)}`);
        }
        allowed.add(eventType.data);
    }
    return allowed;
}

function parseJson(content: string, source: string): unknown {
    try {
        return JSON.parse(content);
    } catch {
        throw new Error(`Invalid ${source}: expected valid JSON`);
    }
}

/** Read once per remote launch; presentation policy never filters RPC control processing. */
export async function loadOmpEventAllowlist(): Promise<ReadonlySet<OmpKnownEventType>> {
    const environment = process.env.HAPI_OMP_EVENT_ALLOWLIST_JSON;
    if (environment !== undefined) {
        const source = 'HAPI_OMP_EVENT_ALLOWLIST_JSON';
        return parseAllowlist(parseJson(environment, source), source);
    }

    // readSettings intentionally tolerates corrupt files; this config must fail explicitly instead.
    const source = `${configuration.settingsFile} ompEventAllowlist`;
    let content: string;
    try {
        content = await readFile(configuration.settingsFile, 'utf8');
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return defaultOmpEventAllowlist;
        }
        throw new Error(`Unable to read ${source}`, { cause: error });
    }
    const settings = SettingsSchema.safeParse(parseJson(content, source));
    if (!settings.success) {
        throw new Error(`Invalid ${source}: settings must be a JSON object`);
    }
    return settings.data.ompEventAllowlist === undefined
        ? defaultOmpEventAllowlist
        : parseAllowlist(settings.data.ompEventAllowlist, source);
}
