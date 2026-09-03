import { z } from 'zod';
import type {
    JsonObject,
    JsonValue,
    OmpAgentMessage,
    OmpCommandType,
    OmpInboundEvent,
    OmpModel,
    OmpResponseData,
    OmpRpcRawResponse
} from './types';
import { OMP_EFFORT_LEVELS, OMP_KNOWN_EVENT_TYPES, OMP_THINKING_LEVELS } from './types';

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
]));

const JsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), JsonValueSchema);
const EffortSchema = z.enum(OMP_EFFORT_LEVELS);
const ThinkingLevelSchema = z.enum(OMP_THINKING_LEVELS);
const ConfiguredThinkingLevelSchema = z.union([ThinkingLevelSchema, z.literal('auto')]);
const QueueModeSchema = z.enum(['all', 'one-at-a-time']);
const InterruptModeSchema = z.enum(['immediate', 'wait']);
const SubscriptionLevelSchema = z.enum(['off', 'progress', 'events']);
const KnownEventTypeSchema = z.enum(OMP_KNOWN_EVENT_TYPES);

const TodoItemSchema = z.object({
    content: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed', 'abandoned'])
});

const TodoPhaseSchema = z.object({
    name: z.string(),
    tasks: z.array(TodoItemSchema)
});

const ContextUsageSchema = z.object({
    tokens: z.number(),
    contextWindow: z.number(),
    percent: z.number()
});

const ModelCoreSchema = z.object({
    id: z.string(),
    name: z.string(),
    api: z.string(),
    provider: z.string(),
    baseUrl: z.string(),
    reasoning: z.boolean(),
    input: z.array(z.enum(['text', 'image'])),
    contextWindow: z.number().nullable(),
    maxTokens: z.number().nullable(),
    thinking: z.object({
        mode: z.string(),
        efforts: z.array(EffortSchema),
        defaultLevel: EffortSchema.optional()
    }).optional()
}).passthrough();

const ModelSchema = ModelCoreSchema.transform((model): OmpModel => {
    const raw = JsonObjectSchema.parse(model);
    return {
        id: model.id,
        name: model.name,
        api: model.api,
        provider: model.provider,
        baseUrl: model.baseUrl,
        reasoning: model.reasoning,
        input: model.input,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        ...(model.thinking ? { thinking: model.thinking } : {}),
        raw
    };
});

const AvailableCommandSchema = z.object({
    name: z.string(),
    aliases: z.array(z.string()).optional(),
    description: z.string().optional(),
    input: z.object({ hint: z.string().optional() }).optional(),
    subcommands: z.array(z.object({
        name: z.string(),
        description: z.string().optional(),
        usage: z.string().optional()
    })).optional(),
    source: z.string()
});

const SessionStateSchema = z.object({
    model: ModelSchema.optional(),
    thinkingLevel: ThinkingLevelSchema.optional(),
    isStreaming: z.boolean(),
    isCompacting: z.boolean(),
    steeringMode: QueueModeSchema,
    followUpMode: QueueModeSchema,
    interruptMode: InterruptModeSchema,
    sessionFile: z.string().optional(),
    sessionId: z.string(),
    sessionName: z.string().optional(),
    autoCompactionEnabled: z.boolean(),
    messageCount: z.number().int().nonnegative(),
    queuedMessageCount: z.number().int().nonnegative(),
    todoPhases: z.array(TodoPhaseSchema),
    systemPrompt: z.array(z.string()).optional(),
    dumpTools: z.array(z.object({
        name: z.string(),
        description: z.string(),
        parameters: JsonValueSchema,
        examples: z.array(JsonValueSchema).optional()
    })).optional(),
    contextUsage: ContextUsageSchema.optional()
});

const SubagentSnapshotSchema = z.object({
    id: z.string(),
    index: z.number().int(),
    agent: z.string(),
    agentSource: z.string(),
    description: z.string().optional(),
    status: z.string(),
    task: z.string().optional(),
    assignment: z.string().optional(),
    sessionFile: z.string().optional(),
    lastUpdate: z.number(),
    progress: JsonObjectSchema.optional(),
    parentToolCallId: z.string().optional()
});

const AgentMessageSchema = JsonObjectSchema.superRefine((message, context) => {
    if (typeof message.role !== 'string') {
        context.addIssue({
            code: 'custom',
            message: 'OMP agent message must contain a string role'
        });
    }
}).transform((message): OmpAgentMessage => ({
    role: message.role as string,
    raw: message
}));

const CompactionResultSchema = z.object({
    summary: z.string(),
    shortSummary: z.string().optional(),
    firstKeptEntryId: z.string(),
    tokensBefore: z.number(),
    details: JsonValueSchema.optional(),
    preserveData: JsonObjectSchema.optional()
});

const BashResultSchema = z.object({
    output: z.string(),
    exitCode: z.number().optional(),
    cancelled: z.boolean(),
    timedOut: z.boolean().optional(),
    truncated: z.boolean(),
    totalLines: z.number(),
    totalBytes: z.number(),
    outputLines: z.number(),
    outputBytes: z.number(),
    artifactId: z.string().optional(),
    workingDir: z.string().optional()
});

const SessionStatsSchema = z.object({
    sessionFile: z.string().optional(),
    sessionId: z.string(),
    userMessages: z.number(),
    assistantMessages: z.number(),
    toolCalls: z.number(),
    toolResults: z.number(),
    totalMessages: z.number(),
    tokens: z.object({
        input: z.number(),
        output: z.number(),
        reasoning: z.number(),
        cacheRead: z.number(),
        cacheWrite: z.number(),
        total: z.number()
    }),
    premiumRequests: z.number(),
    cost: z.number(),
    contextUsage: ContextUsageSchema.optional()
});

const RawResponseSchema = z.discriminatedUnion('success', [
    z.object({
        type: z.literal('response'),
        id: z.string().optional(),
        command: z.string(),
        success: z.literal(true),
        data: JsonValueSchema.optional()
    }),
    z.object({
        type: z.literal('response'),
        id: z.string().optional(),
        command: z.string(),
        success: z.literal(false),
        error: z.string()
    })
]);

export type ParsedOmpInboundLine =
    | { kind: 'ready' }
    | { kind: 'response'; response: OmpRpcRawResponse }
    | { kind: 'event'; event: OmpInboundEvent };

export function parseOmpInboundLine(line: string): ParsedOmpInboundLine {
    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch (error) {
        throw new Error('OMP RPC stdout contained malformed JSON', { cause: error });
    }

    const raw = JsonObjectSchema.parse(parsed);
    const type = raw.type;
    if (typeof type !== 'string') {
        throw new Error('OMP RPC frame is missing a string type');
    }
    if (type === 'ready') {
        return { kind: 'ready' };
    }
    if (type === 'response') {
        return { kind: 'response', response: RawResponseSchema.parse(parsed) };
    }
    const knownType = KnownEventTypeSchema.safeParse(type);
    return {
        kind: 'event',
        event: knownType.success
            ? { kind: 'known', type: knownType.data, raw }
            : { kind: 'unknown', type, raw }
    };
}

function requiredData<T>(command: OmpCommandType, data: JsonValue | undefined, schema: z.ZodType<T>): T {
    if (data === undefined) {
        throw new Error(`OMP RPC response for ${command} is missing data`);
    }
    return schema.parse(data);
}

export function parseOmpResponseData<C extends OmpCommandType>(
    command: C,
    data: JsonValue | undefined
): OmpResponseData<C> {
    let parsed: unknown;
    switch (command) {
        case 'prompt':
            parsed = data === undefined
                ? undefined
                : z.object({ agentInvoked: z.boolean() }).parse(data);
            break;
        case 'steer':
        case 'follow_up':
        case 'abort':
        case 'abort_and_prompt':
        case 'set_thinking_level':
        case 'set_steering_mode':
        case 'set_follow_up_mode':
        case 'set_interrupt_mode':
        case 'set_auto_compaction':
        case 'set_auto_retry':
        case 'abort_retry':
        case 'abort_bash':
        case 'set_session_name':
            parsed = undefined;
            break;
        case 'new_session':
        case 'switch_session':
            parsed = requiredData(command, data, z.object({ cancelled: z.boolean() }));
            break;
        case 'get_state':
            parsed = requiredData(command, data, SessionStateSchema);
            break;
        case 'get_available_commands':
            parsed = requiredData(command, data, z.object({ commands: z.array(AvailableCommandSchema) }));
            break;
        case 'set_todos':
            parsed = requiredData(command, data, z.object({ todoPhases: z.array(TodoPhaseSchema) }));
            break;
        case 'set_host_tools':
            parsed = requiredData(command, data, z.object({ toolNames: z.array(z.string()) }));
            break;
        case 'set_host_uri_schemes':
            parsed = requiredData(command, data, z.object({ schemes: z.array(z.string()) }));
            break;
        case 'set_subagent_subscription':
            parsed = requiredData(command, data, z.object({ level: SubscriptionLevelSchema }));
            break;
        case 'get_subagents':
            parsed = requiredData(command, data, z.object({ subagents: z.array(SubagentSnapshotSchema) }));
            break;
        case 'get_subagent_messages':
            parsed = requiredData(command, data, z.object({
                sessionFile: z.string(),
                fromByte: z.number(),
                nextByte: z.number(),
                reset: z.boolean(),
                entries: z.array(JsonObjectSchema),
                messages: z.array(AgentMessageSchema)
            }));
            break;
        case 'set_model':
            parsed = requiredData(command, data, ModelSchema);
            break;
        case 'cycle_model':
            parsed = requiredData(command, data, z.object({
                model: ModelSchema,
                thinkingLevel: ThinkingLevelSchema.optional(),
                isScoped: z.boolean()
            }).nullable());
            break;
        case 'get_available_models':
            parsed = requiredData(command, data, z.object({ models: z.array(ModelSchema) }));
            break;
        case 'cycle_thinking_level':
            parsed = requiredData(command, data, z.object({ level: ConfiguredThinkingLevelSchema }).nullable());
            break;
        case 'compact':
            parsed = requiredData(command, data, CompactionResultSchema);
            break;
        case 'bash':
            parsed = requiredData(command, data, BashResultSchema);
            break;
        case 'get_session_stats':
            parsed = requiredData(command, data, SessionStatsSchema);
            break;
        case 'export_html':
            parsed = requiredData(command, data, z.object({ path: z.string() }));
            break;
        case 'branch':
            parsed = requiredData(command, data, z.object({ text: z.string(), cancelled: z.boolean() }));
            break;
        case 'get_branch_messages':
            parsed = requiredData(command, data, z.object({
                messages: z.array(z.object({ entryId: z.string(), text: z.string() }))
            }));
            break;
        case 'get_last_assistant_text':
            parsed = requiredData(command, data, z.object({ text: z.string().nullable() }));
            break;
        case 'handoff':
            parsed = requiredData(command, data, z.object({ savedPath: z.string().optional() }).nullable());
            break;
        case 'get_messages':
            parsed = requiredData(command, data, z.object({ messages: z.array(AgentMessageSchema) }));
            break;
        case 'get_login_providers':
            parsed = requiredData(command, data, z.object({
                providers: z.array(z.object({
                    id: z.string(),
                    name: z.string(),
                    available: z.boolean(),
                    authenticated: z.boolean()
                }))
            }));
            break;
        case 'login':
            parsed = requiredData(command, data, z.object({ providerId: z.string() }));
            break;
        default: {
            const exhaustive: never = command;
            throw new Error(`Unhandled OMP RPC command: ${exhaustive}`);
        }
    }
    return parsed as OmpResponseData<C>;
}
