import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentMessage, AgentUsage } from '@/agent/types';
import type { RawJSONLines } from '@/claude/types';
import type {
    JsonObject,
    JsonValue,
    OmpInboundEvent,
    OmpKnownEvent,
    OmpHostIntegrationEvent,
    OmpAvailableCommand,
    OmpSubagentSnapshot
} from './types';

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
]));
const JsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), JsonValueSchema);

const UsageSchema = z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    totalTokens: z.number(),
    reasoningTokens: z.number().optional(),
    cost: z.object({
        input: z.number(),
        output: z.number(),
        cacheRead: z.number(),
        cacheWrite: z.number(),
        total: z.number()
    })
});

const AssistantMessageSchema = z.object({
    role: z.literal('assistant'),
    content: z.array(JsonObjectSchema),
    model: z.string(),
    provider: z.string(),
    responseId: z.string().optional(),
    usage: UsageSchema,
    stopReason: z.enum(['stop', 'length', 'toolUse', 'error', 'aborted']),
    errorMessage: z.string().optional(),
    timestamp: z.number().optional()
});

const ToolResultMessageSchema = z.object({
    role: z.literal('toolResult'),
    toolCallId: z.string(),
    toolName: z.string(),
    content: z.array(JsonObjectSchema),
    details: JsonValueSchema.optional(),
    isError: z.boolean(),
    timestamp: z.number().optional()
});

const UserMessageSchema = z.object({
    role: z.literal('user'),
    steering: z.boolean().optional()
});

const MessageStartSchema = z.object({
    type: z.literal('message_start'),
    message: JsonObjectSchema
});

const MessageUpdateSchema = z.object({
    type: z.literal('message_update'),
    message: JsonObjectSchema,
    assistantMessageEvent: z.object({
        type: z.string(),
        delta: z.string().optional()
    }).passthrough()
});

const MessageEndSchema = z.object({
    type: z.literal('message_end'),
    message: JsonObjectSchema
});

const ToolStartSchema = z.object({
    type: z.literal('tool_execution_start'),
    toolCallId: z.string(),
    toolName: z.string(),
    args: JsonValueSchema
});

const ToolUpdateSchema = z.object({
    type: z.literal('tool_execution_update'),
    toolCallId: z.string(),
    toolName: z.string(),
    args: JsonValueSchema,
    partialResult: JsonValueSchema
});

const ToolEndSchema = z.object({
    type: z.literal('tool_execution_end'),
    toolCallId: z.string(),
    toolName: z.string(),
    result: JsonValueSchema,
    isError: z.boolean().optional()
});

const SubagentLifecycleSchema = z.object({
    type: z.literal('subagent_lifecycle'),
    payload: z.object({
        id: z.string(),
        agent: z.string(),
        agentSource: z.string(),
        description: z.string().optional(),
        status: z.enum(['started', 'completed', 'failed', 'aborted']),
        sessionFile: z.string().optional(),
        parentToolCallId: z.string().optional(),
        index: z.number().int(),
        detached: z.boolean().optional()
    })
});

const SubagentProgressSchema = z.object({
    type: z.literal('subagent_progress'),
    payload: z.object({
        index: z.number().int(),
        agent: z.string(),
        agentSource: z.string(),
        task: z.string(),
        parentToolCallId: z.string().optional(),
        assignment: z.string().optional(),
        progress: JsonObjectSchema,
        sessionFile: z.string().optional(),
        detached: z.boolean().optional()
    })
});

const SubagentEventSchema = z.object({
    type: z.literal('subagent_event'),
    payload: z.object({
        id: z.string(),
        event: JsonObjectSchema
    })
});

const AvailableCommandsUpdateSchema = z.object({
    type: z.literal('available_commands_update'),
    commands: z.array(z.object({
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
    }))
});

const RetryStateSchema = z.object({
    attempt: z.number(),
    maxAttempts: z.number(),
    delayMs: z.number(),
    errorMessage: z.string(),
    startedAtMs: z.number()
}).passthrough();

const RetryFailureSchema = z.object({
    attempt: z.number(),
    errorMessage: z.string()
}).passthrough();

type OmpAgentRunStartEvent = {
    type: 'agent-run-start';
    agentId: string;
    cardId: string;
    startedAt: number;
    status: 'running';
    statusText: string;
    activity: string;
    activityKind: 'starting';
    summary: string;
    parentToolCallId?: string;
    input: {
        agent: string;
        agentSource: string;
        index: number;
        description?: string;
        task?: string;
        assignment?: string;
        parentToolCallId?: string;
        sessionFile?: string;
    };
};

type OmpAgentRunUpdateEvent = {
    type: 'agent-run-update';
    agentId: string;
    cardId: string;
    startedAt: number;
    completedAt?: number;
    status: string;
    statusText: string;
    activity: string;
    activityKind: string;
    summary: string;
    parentToolCallId?: string;
    progress?: JsonObject;
    retryState?: z.infer<typeof RetryStateSchema>;
    retryFailure?: z.infer<typeof RetryFailureSchema>;
    result?: string;
};

export type OmpAgentRunEvent = OmpAgentRunStartEvent | OmpAgentRunUpdateEvent;

export type OmpStructuredEvent =
    | { type: 'omp-rpc-warning'; eventType: string; warning: string; frame: JsonObject }
    | { type: 'omp-retry'; phase: string; frame: JsonObject }
    | { type: 'omp-compaction'; phase: string; frame: JsonObject }
    | { type: 'omp-notice'; level: string; message: string; source?: string; frame: JsonObject }
    | { type: 'omp-session-event'; eventType: string; frame: JsonObject }
    | { type: 'omp-command-output'; text: string; frame: JsonObject }
    | { type: 'omp-extension-error'; message: string; frame: JsonObject };

type MainMessageAccumulator = {
    displayId: string;
    role: JsonValue | undefined;
    snapshot: JsonObject;
};

type ToolLifecycle = {
    id: string;
    name: string;
    args: JsonValue;
    partialResult?: JsonValue;
    executionResult?: JsonValue;
    executionFailed?: boolean;
};

type SubagentState = {
    id: string;
    cardId: string;
    agent: string;
    agentSource: string;
    index: number;
    startedAt: number;
    description?: string;
    task?: string;
    assignment?: string;
    sessionFile?: string;
    parentToolCallId?: string;
    lastResultText?: string;
    terminalStatus?: string;
    startEmitted: boolean;
    seenMessages: Set<string>;
    tools: Map<string, ToolLifecycle>;
};

export type OmpRpcEventAdapterCallbacks = {
    onAgentMessage: (message: AgentMessage) => void;
    onCanonicalMessage: (message: RawJSONLines) => void;
    onAgentRunEvent: (event: OmpAgentRunEvent) => void;
    onAgentRunTrace: (scope: {
        agentId: string;
        cardId: string;
        parentToolCallId?: string;
        startedAt: number;
    }, message: AgentMessage) => void;
    onStructuredEvent: (event: OmpStructuredEvent) => void;
    onInkMessage: (message: string, type: 'assistant' | 'system' | 'tool' | 'result' | 'status') => void;
    onUserMessageCommitted: (steering: boolean) => void;
    onTurnStarted: () => void;
    onTurnFinished: () => void;
    onPromptResult: (agentInvoked: boolean) => void;
    onSessionInfoUpdate: () => void;
    onAvailableCommandsChanged: (commands: OmpAvailableCommand[]) => void;
    onThinkingStateChanged: (state: {
        thinkingLevel?: import('./types').OmpThinkingLevel;
        configured?: import('./types').OmpConfiguredThinkingLevel;
        resolved?: import('./types').OmpEffort;
    }) => void;
    onDiagnostic: (message: string) => void;
    onHostEvent: (event: {
        type: OmpHostIntegrationEvent['type'];
        raw: JsonObject;
    }) => void;
};

export class OmpRpcEventAdapter {
    private activeMessage: MainMessageAccumulator | null = null;
    private lastDisplayId: string | null = null;
    private readonly tools = new Map<string, ToolLifecycle>();
    private readonly subagents = new Map<string, SubagentState>();

    constructor(private readonly callbacks: OmpRpcEventAdapterCallbacks) {}

    handle(event: OmpInboundEvent): void {
        if (event.kind === 'unknown') {
            this.callbacks.onStructuredEvent({
                type: 'omp-rpc-warning',
                eventType: event.type,
                warning: `Unknown OMP RPC event: ${event.type}`,
                frame: event.raw
            });
            this.callbacks.onDiagnostic(`Unknown OMP RPC event: ${event.type}`);
            return;
        }
        this.handleKnown(event);
    }

    seedSubagents(snapshots: OmpSubagentSnapshot[]): void {
        for (const snapshot of snapshots) {
            const state = this.ensureSubagent({
                id: snapshot.id,
                agent: snapshot.agent,
                agentSource: snapshot.agentSource,
                index: snapshot.index,
                description: snapshot.description,
                task: snapshot.task,
                assignment: snapshot.assignment,
                sessionFile: snapshot.sessionFile,
                parentToolCallId: snapshot.parentToolCallId,
                startedAt: snapshot.lastUpdate
            });
            this.emitSubagentStart(state);
            if (snapshot.progress) {
                this.emitSubagentProgress(state, snapshot.progress, snapshot.status);
            }
        }
    }

    seedSubagentMessages(subagentId: string, messages: JsonObject[]): void {
        const state = this.subagents.get(subagentId);
        if (!state) {
            this.callbacks.onDiagnostic(`OMP subagent transcript has no registry entry: ${subagentId}`);
            return;
        }
        for (const message of messages) {
            this.emitSubagentMessage(state, message);
        }
    }

    private handleKnown(event: OmpKnownEvent): void {
        switch (event.type) {
            case 'agent_start':
                this.callbacks.onTurnStarted();
                return;
            case 'agent_end':
                this.reconcileBoundary('agent_end');
                this.callbacks.onTurnFinished();
                return;
            case 'turn_start':
                return;
            case 'turn_end':
                this.reconcileBoundary('turn_end');
                return;
            case 'message_start':
                this.handleMessageStart(event.raw);
                return;
            case 'message_update':
                this.handleMessageUpdate(event.raw);
                return;
            case 'message_end':
                this.handleMessageEnd(event.raw);
                return;
            case 'tool_execution_start':
                this.handleToolStart(event.raw);
                return;
            case 'tool_execution_update':
                this.handleToolUpdate(event.raw);
                return;
            case 'tool_execution_end':
                this.handleToolEnd(event.raw);
                return;
            case 'prompt_result': {
                const parsed = z.object({ agentInvoked: z.boolean() }).safeParse(event.raw);
                if (parsed.success) {
                    this.callbacks.onPromptResult(parsed.data.agentInvoked);
                } else {
                    this.invalidEvent(event.type, parsed.error);
                }
                return;
            }
            case 'notice':
                this.handleNotice(event.raw);
                return;
            case 'auto_retry_start':
                this.handleRetryEvent(event.raw, 'started');
                return;
            case 'auto_retry_end':
                this.handleRetryEvent(event.raw, 'finished');
                return;
            case 'retry_fallback_applied':
                this.handleRetryEvent(event.raw, 'fallback-applied');
                return;
            case 'retry_fallback_succeeded':
                this.handleRetryEvent(event.raw, 'fallback-succeeded');
                return;
            case 'auto_compaction_start':
                this.callbacks.onStructuredEvent({ type: 'omp-compaction', phase: 'started', frame: event.raw });
                this.callbacks.onInkMessage('OMP compaction started', 'status');
                return;
            case 'auto_compaction_end':
                this.callbacks.onStructuredEvent({ type: 'omp-compaction', phase: 'finished', frame: event.raw });
                this.callbacks.onInkMessage('OMP compaction finished', 'status');
                return;
            case 'thinking_level_changed':
                this.handleThinkingLevelChanged(event.raw);
                return;
            case 'available_commands_update': {
                const parsed = AvailableCommandsUpdateSchema.safeParse(event.raw);
                if (!parsed.success) {
                    this.invalidEvent('available_commands_update', parsed.error);
                    return;
                }
                this.callbacks.onAvailableCommandsChanged(parsed.data.commands);
                return;
            }
            case 'session_info_update':
            case 'config_update':
                this.callbacks.onSessionInfoUpdate();
                return;
            case 'ttsr_triggered':
            case 'todo_reminder':
            case 'todo_auto_clear':
            case 'irc_message':
            case 'goal_updated':
                this.callbacks.onStructuredEvent({
                    type: 'omp-session-event',
                    eventType: event.type,
                    frame: event.raw
                });
                this.callbacks.onSessionInfoUpdate();
                return;
            case 'command_output':
                this.handleCommandOutput(event.raw);
                return;
            case 'extension_error':
                this.handleExtensionError(event.raw);
                return;
            case 'subagent_lifecycle':
                this.handleSubagentLifecycle(event.raw);
                return;
            case 'subagent_progress':
                this.handleSubagentProgress(event.raw);
                return;
            case 'subagent_event':
                this.handleSubagentEvent(event.raw);
                return;
            case 'extension_ui_request':
            case 'host_tool_call':
            case 'host_tool_cancel':
            case 'host_uri_request':
            case 'host_uri_cancel':
                this.callbacks.onHostEvent({ type: event.type, raw: event.raw });
                return;
        }
        const exhaustive: never = event.type;
        return exhaustive;
    }

    private handleMessageStart(raw: JsonObject): void {
        const parsed = MessageStartSchema.safeParse(raw);
        if (!parsed.success) {
            this.invalidEvent('message_start', parsed.error);
            return;
        }
        if (this.activeMessage) {
            this.callbacks.onDiagnostic(
                `OMP message_start replaced unfinished ${String(this.activeMessage.role ?? 'unknown')} message`
            );
        }
        this.activeMessage = {
            displayId: randomUUID(),
            role: parsed.data.message.role,
            snapshot: parsed.data.message
        };
    }

    private handleMessageUpdate(raw: JsonObject): void {
        const parsed = MessageUpdateSchema.safeParse(raw);
        if (!parsed.success) {
            this.invalidEvent('message_update', parsed.error);
            return;
        }
        if (!this.activeMessage) {
            this.callbacks.onDiagnostic('OMP message_update arrived without message_start; allocated a display UUID');
            this.activeMessage = {
                displayId: randomUUID(),
                role: parsed.data.message.role,
                snapshot: parsed.data.message
            };
        } else {
            this.activeMessage = {
                ...this.activeMessage,
                role: parsed.data.message.role,
                snapshot: parsed.data.message
            };
        }

        const { type, delta } = parsed.data.assistantMessageEvent;
        if (!delta) return;
        if (type === 'text_delta') {
            this.callbacks.onInkMessage(delta, 'assistant');
        } else if (type === 'thinking_delta') {
            this.callbacks.onInkMessage(`[Thinking] ${delta}`, 'system');
        }
    }

    private handleMessageEnd(raw: JsonObject): void {
        const event = MessageEndSchema.safeParse(raw);
        if (!event.success) {
            this.invalidEvent('message_end', event.error);
            return;
        }

        const displayId = this.activeMessage?.displayId ?? randomUUID();
        if (!this.activeMessage) {
            this.callbacks.onDiagnostic('OMP message_end arrived without message_start; allocated a display UUID');
        }
        this.activeMessage = null;

        const assistant = AssistantMessageSchema.safeParse(event.data.message);
        if (assistant.success) {
            this.commitAssistant(displayId, assistant.data);
            return;
        }

        const toolResult = ToolResultMessageSchema.safeParse(event.data.message);
        if (toolResult.success) {
            this.commitToolResult(displayId, toolResult.data);
            return;
        }

        const user = UserMessageSchema.safeParse(event.data.message);
        if (user.success) {
            this.callbacks.onUserMessageCommitted(user.data.steering === true);
            return;
        }

        const role = event.data.message.role;
        if (role !== 'developer') {
            this.callbacks.onDiagnostic(`Unsupported OMP message_end role: ${String(role)}`);
        }
    }

    private commitAssistant(
        displayId: string,
        assistant: z.infer<typeof AssistantMessageSchema>
    ): void {
        const modelLabel = `${assistant.provider}/${assistant.model}`;
        const usage = this.toAgentUsage(assistant.usage);
        const content = assistant.content.flatMap((block): JsonObject[] => {
            if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
                return [{ type: 'text', text: block.text }];
            }
            if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.length > 0) {
                return [{ type: 'thinking', thinking: block.thinking }];
            }
            if (
                block.type === 'toolCall'
                && typeof block.id === 'string'
                && typeof block.name === 'string'
                && block.arguments !== null
                && typeof block.arguments === 'object'
                && !Array.isArray(block.arguments)
            ) {
                return [{
                    type: 'tool_use',
                    id: block.id,
                    name: block.name,
                    input: block.arguments
                }];
            }
            if (!['image', 'redactedThinking', 'fallback'].includes(String(block.type))) {
                this.callbacks.onDiagnostic(`Unknown OMP assistant content block: ${String(block.type)}`);
            }
            return [];
        });

        const parentUuid = this.lastDisplayId;
        const timestamp = new Date(assistant.timestamp ?? Date.now()).toISOString();
        this.callbacks.onCanonicalMessage({
            type: 'assistant',
            uuid: displayId,
            parentUuid,
            isSidechain: false,
            providerMessageId: assistant.responseId,
            timestamp,
            message: {
                role: 'assistant',
                content,
                model: modelLabel,
                usage: {
                    input_tokens: assistant.usage.input,
                    output_tokens: assistant.usage.output,
                    cache_creation_input_tokens: assistant.usage.cacheWrite,
                    cache_read_input_tokens: assistant.usage.cacheRead,
                    reasoning_output_tokens: assistant.usage.reasoningTokens,
                    cost_usd: assistant.usage.cost.total
                }
            }
        });
        this.lastDisplayId = displayId;
        this.callbacks.onAgentMessage({ type: 'usage', ...usage });
        if (assistant.errorMessage) {
            this.callbacks.onAgentMessage({ type: 'error', message: assistant.errorMessage });
        }
    }

    private commitToolResult(
        displayId: string,
        toolResult: z.infer<typeof ToolResultMessageSchema>
    ): void {
        const parentUuid = this.lastDisplayId;
        const timestamp = new Date(toolResult.timestamp ?? Date.now()).toISOString();
        const output = {
            content: toolResult.content,
            details: toolResult.details
        };
        this.callbacks.onCanonicalMessage({
            type: 'user',
            uuid: displayId,
            parentUuid,
            isSidechain: false,
            timestamp,
            message: {
                role: 'user',
                content: [{
                    type: 'tool_result',
                    tool_use_id: toolResult.toolCallId,
                    content: output,
                    is_error: toolResult.isError
                }]
            },
            toolUseResult: output
        });
        this.lastDisplayId = displayId;
        this.tools.delete(toolResult.toolCallId);
        this.callbacks.onInkMessage(
            this.textFromContent(toolResult.content) || `Tool ${toolResult.toolName} finished`,
            'result'
        );
    }

    private handleToolStart(raw: JsonObject): void {
        const parsed = ToolStartSchema.safeParse(raw);
        if (!parsed.success) {
            this.invalidEvent('tool_execution_start', parsed.error);
            return;
        }
        const tool: ToolLifecycle = {
            id: parsed.data.toolCallId,
            name: parsed.data.toolName,
            args: parsed.data.args
        };
        this.tools.set(tool.id, tool);
        this.emitToolLifecycle(tool, 'in_progress');
        this.callbacks.onInkMessage(`Tool call: ${tool.name}`, 'tool');
    }

    private handleToolUpdate(raw: JsonObject): void {
        const parsed = ToolUpdateSchema.safeParse(raw);
        if (!parsed.success) {
            this.invalidEvent('tool_execution_update', parsed.error);
            return;
        }
        const existing = this.tools.get(parsed.data.toolCallId);
        const tool: ToolLifecycle = {
            id: parsed.data.toolCallId,
            name: existing?.name ?? parsed.data.toolName,
            args: existing?.args ?? parsed.data.args,
            partialResult: parsed.data.partialResult,
            executionResult: existing?.executionResult,
            executionFailed: existing?.executionFailed
        };
        this.tools.set(tool.id, tool);
        this.emitToolLifecycle(tool, 'in_progress');
    }

    private handleToolEnd(raw: JsonObject): void {
        const parsed = ToolEndSchema.safeParse(raw);
        if (!parsed.success) {
            this.invalidEvent('tool_execution_end', parsed.error);
            return;
        }
        const existing = this.tools.get(parsed.data.toolCallId);
        const tool: ToolLifecycle = {
            id: parsed.data.toolCallId,
            name: parsed.data.toolName,
            args: existing?.args ?? {},
            partialResult: existing?.partialResult,
            executionResult: parsed.data.result,
            executionFailed: parsed.data.isError === true
        };
        this.tools.set(tool.id, tool);
        this.emitToolLifecycle(tool, tool.executionFailed ? 'failed' : 'completed');
    }

    private emitToolLifecycle(tool: ToolLifecycle, status: Extract<AgentMessage, { type: 'tool_call' }>['status']): void {
        this.callbacks.onAgentMessage({
            type: 'tool_call',
            id: tool.id,
            name: tool.name,
            input: tool.args,
            status
        });
    }

    private handleRetryEvent(raw: JsonObject, phase: string): void {
        this.callbacks.onStructuredEvent({ type: 'omp-retry', phase, frame: raw });
        this.callbacks.onInkMessage(`OMP retry ${phase}`, 'status');
    }

    private handleNotice(raw: JsonObject): void {
        const parsed = z.object({
            level: z.string(),
            message: z.string(),
            source: z.string().optional()
        }).safeParse(raw);
        if (!parsed.success) {
            this.invalidEvent('notice', parsed.error);
            return;
        }
        this.callbacks.onStructuredEvent({
            type: 'omp-notice',
            level: parsed.data.level,
            message: parsed.data.message,
            source: parsed.data.source,
            frame: raw
        });
        this.callbacks.onInkMessage(`[${parsed.data.level}] ${parsed.data.message}`, 'status');
    }

    private handleCommandOutput(raw: JsonObject): void {
        const parsed = z.object({ text: z.string() }).safeParse(raw);
        if (!parsed.success) {
            this.invalidEvent('command_output', parsed.error);
            return;
        }
        this.callbacks.onStructuredEvent({ type: 'omp-command-output', text: parsed.data.text, frame: raw });
        this.callbacks.onInkMessage(parsed.data.text, 'status');
    }

    private handleExtensionError(raw: JsonObject): void {
        const error = typeof raw.error === 'string' ? raw.error : JSON.stringify(raw.error ?? raw);
        this.callbacks.onStructuredEvent({ type: 'omp-extension-error', message: error, frame: raw });
        this.callbacks.onDiagnostic(`OMP extension error: ${error}`);
    }

    private handleThinkingLevelChanged(raw: JsonObject): void {
        const parsed = z.object({
            thinkingLevel: z.enum([
                'inherit',
                'off',
                'minimal',
                'low',
                'medium',
                'high',
                'xhigh',
                'max'
            ]).optional(),
            configured: z.union([
                z.enum([
                    'inherit',
                    'off',
                    'minimal',
                    'low',
                    'medium',
                    'high',
                    'xhigh',
                    'max'
                ]),
                z.literal('auto')
            ]).optional(),
            resolved: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional()
        }).safeParse(raw);
        if (!parsed.success) {
            this.invalidEvent('thinking_level_changed', parsed.error);
            return;
        }
        this.callbacks.onThinkingStateChanged(parsed.data);
    }

    private handleSubagentLifecycle(raw: JsonObject): void {
        const parsed = SubagentLifecycleSchema.safeParse(raw);
        if (!parsed.success) {
            this.invalidEvent('subagent_lifecycle', parsed.error);
            return;
        }
        const payload = parsed.data.payload;
        const state = this.ensureSubagent({
            ...payload,
            startedAt: Date.now()
        });
        if (payload.status === 'started') {
            this.emitSubagentStart(state);
            return;
        }
        state.terminalStatus = payload.status;
        this.emitSubagentTerminal(state, payload.status);
    }

    private handleSubagentProgress(raw: JsonObject): void {
        const parsed = SubagentProgressSchema.safeParse(raw);
        if (!parsed.success) {
            this.invalidEvent('subagent_progress', parsed.error);
            return;
        }
        const payload = parsed.data.payload;
        const progressId = typeof payload.progress.id === 'string' ? payload.progress.id : null;
        if (!progressId) {
            this.callbacks.onDiagnostic('Invalid OMP subagent_progress: progress.id is missing');
            return;
        }
        const state = this.ensureSubagent({
            id: progressId,
            agent: payload.agent,
            agentSource: payload.agentSource,
            index: payload.index,
            task: payload.task,
            assignment: payload.assignment,
            sessionFile: payload.sessionFile,
            parentToolCallId: payload.parentToolCallId,
            startedAt: Date.now()
        });
        this.emitSubagentStart(state);
        const status = typeof payload.progress.status === 'string' ? payload.progress.status : 'running';
        this.emitSubagentProgress(state, payload.progress, status);
    }

    private handleSubagentEvent(raw: JsonObject): void {
        const parsed = SubagentEventSchema.safeParse(raw);
        if (!parsed.success) {
            this.invalidEvent('subagent_event', parsed.error);
            return;
        }
        const state = this.subagents.get(parsed.data.payload.id);
        if (!state) {
            this.callbacks.onDiagnostic(`OMP subagent_event has no registry entry: ${parsed.data.payload.id}`);
            return;
        }
        const childEvent = parsed.data.payload.event;
        if (childEvent.type === 'message_end') {
            const message = JsonObjectSchema.safeParse(childEvent.message);
            if (message.success) {
                this.emitSubagentMessage(state, message.data);
                return;
            }
        }
        if (childEvent.type === 'tool_execution_start') {
            this.emitSubagentToolLifecycle(state, childEvent, 'in_progress');
            return;
        }
        if (childEvent.type === 'tool_execution_update') {
            this.emitSubagentToolLifecycle(state, childEvent, 'in_progress');
            return;
        }
        if (childEvent.type === 'tool_execution_end') {
            this.emitSubagentToolLifecycle(
                state,
                childEvent,
                childEvent.isError === true ? 'failed' : 'completed'
            );
            return;
        }
        if (childEvent.type === 'notice' && typeof childEvent.message === 'string') {
            this.emitSubagentTrace(state, { type: 'error', message: childEvent.message });
            return;
        }
        if (
            childEvent.type === 'auto_retry_start'
            || childEvent.type === 'auto_retry_end'
            || childEvent.type === 'retry_fallback_applied'
            || childEvent.type === 'retry_fallback_succeeded'
        ) {
            this.emitSubagentTrace(state, {
                type: 'error',
                message: `OMP ${String(childEvent.type)}: ${JSON.stringify(childEvent)}`
            });
        }
    }

    private emitSubagentMessage(state: SubagentState, message: JsonObject): void {
        const signature = this.subagentMessageSignature(message);
        if (state.seenMessages.has(signature)) return;
        state.seenMessages.add(signature);

        const assistant = AssistantMessageSchema.safeParse(message);
        if (assistant.success) {
            const model = `${assistant.data.provider}/${assistant.data.model}`;
            const usage = this.toAgentUsage(assistant.data.usage);
            const assistantText = this.textFromContent(assistant.data.content);
            if (assistantText.length > 0) {
                state.lastResultText = assistantText;
            }
            for (const block of assistant.data.content) {
                if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
                    this.emitSubagentTrace(state, { type: 'text', text: block.text, model, usage });
                } else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.length > 0) {
                    this.emitSubagentTrace(state, { type: 'reasoning', text: block.thinking, model, usage });
                } else if (
                    block.type === 'toolCall'
                    && typeof block.id === 'string'
                    && typeof block.name === 'string'
                ) {
                    this.emitSubagentTrace(state, {
                        type: 'tool_call',
                        id: block.id,
                        name: block.name,
                        input: block.arguments,
                        status: 'in_progress',
                        model,
                        usage
                    });
                }
            }
            if (assistant.data.errorMessage) {
                this.emitSubagentTrace(state, { type: 'error', message: assistant.data.errorMessage });
            }
            if (state.terminalStatus) {
                this.emitSubagentTerminal(state, state.terminalStatus);
            }
            return;
        }

        const toolResult = ToolResultMessageSchema.safeParse(message);
        if (toolResult.success) {
            this.emitSubagentTrace(state, {
                type: 'tool_result',
                id: toolResult.data.toolCallId,
                output: {
                    content: toolResult.data.content,
                    details: toolResult.data.details
                },
                status: toolResult.data.isError ? 'failed' : 'completed'
            });
            state.tools.delete(toolResult.data.toolCallId);
        }
    }

    private emitSubagentToolLifecycle(
        state: SubagentState,
        event: JsonObject,
        status: Extract<AgentMessage, { type: 'tool_call' }>['status']
    ): void {
        if (
            typeof event.toolCallId !== 'string'
            || typeof event.toolName !== 'string'
        ) {
            this.callbacks.onDiagnostic(`Invalid OMP subagent tool event: ${JSON.stringify(event)}`);
            return;
        }
        const existing = state.tools.get(event.toolCallId);
        const tool: ToolLifecycle = {
            id: event.toolCallId,
            name: existing?.name ?? event.toolName,
            args: existing?.args ?? event.args ?? {},
            partialResult: event.partialResult ?? existing?.partialResult,
            executionResult: event.result ?? existing?.executionResult,
            executionFailed: event.isError === true || existing?.executionFailed
        };
        state.tools.set(tool.id, tool);
        this.emitSubagentTrace(state, {
            type: 'tool_call',
            id: tool.id,
            name: tool.name,
            input: tool.args,
            status
        });
    }

    private ensureSubagent(input: {
        id: string;
        agent: string;
        agentSource: string;
        index: number;
        startedAt: number;
        description?: string;
        task?: string;
        assignment?: string;
        sessionFile?: string;
        parentToolCallId?: string;
    }): SubagentState {
        const existing = this.subagents.get(input.id);
        if (existing) {
            existing.description = input.description ?? existing.description;
            existing.task = input.task ?? existing.task;
            existing.assignment = input.assignment ?? existing.assignment;
            existing.sessionFile = input.sessionFile ?? existing.sessionFile;
            existing.parentToolCallId = input.parentToolCallId ?? existing.parentToolCallId;
            return existing;
        }
        const state: SubagentState = {
            ...input,
            cardId: `omp-subagent:${input.id}`,
            startEmitted: false,
            seenMessages: new Set(),
            tools: new Map()
        };
        this.subagents.set(input.id, state);
        return state;
    }

    private emitSubagentStart(state: SubagentState): void {
        if (state.startEmitted) return;
        state.startEmitted = true;
        const summary = state.description ?? state.assignment ?? state.task ?? state.agent;
        this.callbacks.onAgentRunEvent({
            type: 'agent-run-start',
            agentId: state.id,
            cardId: state.cardId,
            startedAt: state.startedAt,
            status: 'running',
            statusText: 'Running',
            activity: 'Starting',
            activityKind: 'starting',
            summary,
            parentToolCallId: state.parentToolCallId,
            input: {
                agent: state.agent,
                agentSource: state.agentSource,
                index: state.index,
                description: state.description,
                task: state.task,
                assignment: state.assignment,
                parentToolCallId: state.parentToolCallId,
                sessionFile: state.sessionFile
            }
        });
    }

    private emitSubagentProgress(state: SubagentState, progress: JsonObject, status: string): void {
        const retryState = RetryStateSchema.safeParse(progress.retryState);
        const retryFailure = RetryFailureSchema.safeParse(progress.retryFailure);
        const yieldedResult = this.subagentYieldResult(progress);
        if (yieldedResult !== undefined) {
            state.lastResultText = yieldedResult;
        }
        const currentTool = typeof progress.currentTool === 'string' ? progress.currentTool : null;
        const activity = retryState.success
            ? `Retrying provider request (${retryState.data.attempt}/${retryState.data.maxAttempts})`
            : currentTool
                ? `Using ${currentTool}`
                : status === 'running' ? 'Running' : status;
        this.callbacks.onAgentRunEvent({
            type: 'agent-run-update',
            agentId: state.id,
            cardId: state.cardId,
            startedAt: state.startedAt,
            status,
            statusText: activity,
            activity,
            activityKind: retryState.success ? 'retry' : currentTool ? 'tool' : status,
            summary: state.description ?? state.assignment ?? state.task ?? state.agent,
            parentToolCallId: state.parentToolCallId,
            progress,
            retryState: retryState.success ? retryState.data : undefined,
            retryFailure: retryFailure.success ? retryFailure.data : undefined,
            result: status === 'completed' ? state.lastResultText : undefined
        });
    }

    private emitSubagentTerminal(state: SubagentState, status: string): void {
        const normalizedStatus = status === 'aborted' ? 'canceled' : status;
        const activity = normalizedStatus === 'completed'
            ? 'Completed'
            : normalizedStatus === 'canceled' ? 'Canceled' : 'Failed';
        this.callbacks.onAgentRunEvent({
            type: 'agent-run-update',
            agentId: state.id,
            cardId: state.cardId,
            startedAt: state.startedAt,
            completedAt: Date.now(),
            status: normalizedStatus,
            statusText: activity,
            activity,
            activityKind: normalizedStatus,
            summary: state.description ?? state.assignment ?? state.task ?? state.agent,
            parentToolCallId: state.parentToolCallId,
            result: state.lastResultText
        });
    }

    private subagentYieldResult(progress: JsonObject): string | undefined {
        const extracted = progress.extractedToolData;
        if (extracted === null || Array.isArray(extracted) || typeof extracted !== 'object') {
            return undefined;
        }
        const yields = extracted.yield;
        if (!Array.isArray(yields)) return undefined;

        for (let index = yields.length - 1; index >= 0; index -= 1) {
            const entry = yields[index];
            if (entry === null || Array.isArray(entry) || typeof entry !== 'object') continue;
            if (entry.status === 'success' && typeof entry.data === 'string' && entry.data.length > 0) {
                return entry.data;
            }
        }
        return undefined;
    }

    private emitSubagentTrace(state: SubagentState, message: AgentMessage): void {
        this.callbacks.onAgentRunTrace({
            agentId: state.id,
            cardId: state.cardId,
            parentToolCallId: state.parentToolCallId,
            startedAt: state.startedAt
        }, message);
    }

    private subagentMessageSignature(message: JsonObject): string {
        const responseId = typeof message.responseId === 'string' ? message.responseId : null;
        if (responseId) return `response:${responseId}`;
        if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
            return `toolResult:${message.toolCallId}:${JSON.stringify(message.content)}`;
        }
        return JSON.stringify(message);
    }

    private reconcileBoundary(boundary: 'turn_end' | 'agent_end'): void {
        if (!this.activeMessage) return;
        this.callbacks.onDiagnostic(
            `OMP ${boundary} reconciled an unfinished ${String(this.activeMessage.role ?? 'unknown')} message without appending it`
        );
        this.activeMessage = null;
    }

    private toAgentUsage(usage: z.infer<typeof UsageSchema>): AgentUsage {
        return {
            inputTokens: usage.input,
            outputTokens: usage.output,
            totalTokens: usage.totalTokens,
            thoughtTokens: usage.reasoningTokens,
            cacheReadTokens: usage.cacheRead,
            costUsd: usage.cost.total
        };
    }

    private textFromContent(content: JsonObject[]): string {
        return content
            .map((block) => block.type === 'text' && typeof block.text === 'string' ? block.text : '')
            .filter(Boolean)
            .join('\n');
    }

    private invalidEvent(type: string, error: z.ZodError): void {
        this.callbacks.onDiagnostic(`Invalid OMP RPC event ${type}: ${error.message}`);
    }
}
