import { z } from 'zod';
import type { AgentMessage, AgentUsage } from '@/agent/types';
import type { JsonObject, JsonValue, OmpInboundEvent } from './types';

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
    errorMessage: z.string().optional()
});

const ToolResultMessageSchema = z.object({
    role: z.literal('toolResult'),
    toolCallId: z.string(),
    toolName: z.string(),
    content: z.array(JsonObjectSchema),
    details: JsonValueSchema.optional(),
    isError: z.boolean()
});

const UserMessageSchema = z.object({
    role: z.literal('user'),
    steering: z.boolean().optional()
});

const MessageEndSchema = z.object({
    type: z.literal('message_end'),
    message: JsonObjectSchema
});

const MessageUpdateSchema = z.object({
    type: z.literal('message_update'),
    assistantMessageEvent: z.object({
        type: z.string(),
        delta: z.string().optional()
    }).passthrough()
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

export type OmpRpcEventAdapterCallbacks = {
    onAgentMessage: (message: AgentMessage) => void;
    onInkMessage: (message: string, type: 'assistant' | 'system' | 'tool' | 'result' | 'status') => void;
    onUserMessageCommitted: (steering: boolean) => void;
    onTurnStarted: () => void;
    onTurnFinished: () => void;
    onPromptResult: (agentInvoked: boolean) => void;
    onSessionInfoUpdate: () => void;
    onThinkingStateChanged: (state: {
        thinkingLevel?: import('./types').OmpThinkingLevel;
        configured?: import('./types').OmpConfiguredThinkingLevel;
        resolved?: import('./types').OmpEffort;
    }) => void;
    onDiagnostic: (message: string) => void;
};

export class OmpRpcEventAdapter {
    constructor(private readonly callbacks: OmpRpcEventAdapterCallbacks) {}

    handle(event: OmpInboundEvent): void {
        switch (event.type) {
            case 'agent_start':
                this.callbacks.onTurnStarted();
                return;
            case 'agent_end':
                this.callbacks.onTurnFinished();
                return;
            case 'turn_start':
            case 'turn_end':
            case 'message_start':
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
            case 'notice': {
                const parsed = z.object({ level: z.string(), message: z.string() }).safeParse(event.raw);
                if (parsed.success) {
                    this.callbacks.onInkMessage(`[${parsed.data.level}] ${parsed.data.message}`, 'status');
                } else {
                    this.invalidEvent(event.type, parsed.error);
                }
                return;
            }
            case 'auto_retry_start':
                this.handleStatusEvent(event.raw, 'OMP retry started');
                return;
            case 'auto_retry_end':
                this.handleStatusEvent(event.raw, 'OMP retry finished');
                return;
            case 'retry_fallback_applied':
                this.handleStatusEvent(event.raw, 'OMP fallback model applied');
                return;
            case 'retry_fallback_succeeded':
                this.handleStatusEvent(event.raw, 'OMP fallback model succeeded');
                return;
            case 'session_info_update':
                this.callbacks.onSessionInfoUpdate();
                return;
            case 'auto_compaction_start':
                this.handleStatusEvent(event.raw, 'OMP compaction started');
                return;
            case 'auto_compaction_end':
                this.handleStatusEvent(event.raw, 'OMP compaction finished');
                return;
            case 'thinking_level_changed':
                this.handleThinkingLevelChanged(event.raw);
                return;
            case 'ttsr_triggered':
            case 'todo_reminder':
            case 'todo_auto_clear':
            case 'irc_message':
            case 'goal_updated':
            case 'available_commands_update':
            case 'config_update':
                this.callbacks.onSessionInfoUpdate();
                return;
            case 'command_output':
            case 'extension_error':
            case 'subagent_lifecycle':
            case 'subagent_progress':
            case 'subagent_event':
            case 'extension_ui_request':
            case 'host_tool_call':
            case 'host_tool_cancel':
            case 'host_uri_request':
            case 'host_uri_cancel':
                this.callbacks.onDiagnostic(`OMP RPC event ${event.type} is not owned by the transport adapter`);
                return;
            default:
                this.callbacks.onDiagnostic(`Unknown OMP RPC event: ${event.type}`);
        }
    }

    private handleMessageUpdate(raw: JsonObject): void {
        const parsed = MessageUpdateSchema.safeParse(raw);
        if (!parsed.success) {
            this.invalidEvent('message_update', parsed.error);
            return;
        }
        const { type, delta } = parsed.data.assistantMessageEvent;
        if (!delta) {
            return;
        }
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

        const assistant = AssistantMessageSchema.safeParse(event.data.message);
        if (assistant.success) {
            const modelLabel = `${assistant.data.provider}/${assistant.data.model}`;
            const usage: AgentUsage = {
                inputTokens: assistant.data.usage.input,
                outputTokens: assistant.data.usage.output,
                totalTokens: assistant.data.usage.totalTokens,
                thoughtTokens: assistant.data.usage.reasoningTokens,
                cacheReadTokens: assistant.data.usage.cacheRead,
                costUsd: assistant.data.usage.cost.total
            };
            let decoratedBlockIndex = -1;
            for (let index = assistant.data.content.length - 1; index >= 0; index -= 1) {
                if (this.isForwardedAssistantContent(assistant.data.content[index]!)) {
                    decoratedBlockIndex = index;
                    break;
                }
            }
            for (const [index, block] of assistant.data.content.entries()) {
                this.handleAssistantContent(
                    block,
                    index === decoratedBlockIndex ? { model: modelLabel, usage } : undefined
                );
            }
            this.callbacks.onAgentMessage({
                type: 'usage',
                ...usage
            });
            if (assistant.data.errorMessage) {
                this.callbacks.onAgentMessage({ type: 'error', message: assistant.data.errorMessage });
            }
            return;
        }

        const toolResult = ToolResultMessageSchema.safeParse(event.data.message);
        if (toolResult.success) {
            this.callbacks.onAgentMessage({
                type: 'tool_result',
                id: toolResult.data.toolCallId,
                output: {
                    content: toolResult.data.content,
                    details: toolResult.data.details
                },
                status: toolResult.data.isError ? 'failed' : 'completed'
            });
            this.callbacks.onInkMessage(
                this.textFromContent(toolResult.data.content) || `Tool ${toolResult.data.toolName} finished`,
                'result'
            );
            return;
        }

        const user = UserMessageSchema.safeParse(event.data.message);
        if (user.success) {
            this.callbacks.onUserMessageCommitted(user.data.steering === true);
            return;
        }

        const role = event.data.message.role;
        if (role !== 'user' && role !== 'developer') {
            this.callbacks.onDiagnostic(`Unsupported OMP message_end role: ${String(role)}`);
        }
    }

    private isForwardedAssistantContent(block: JsonObject): boolean {
        if (block.type === 'text') {
            return typeof block.text === 'string' && block.text.length > 0;
        }
        if (block.type === 'thinking') {
            return typeof block.thinking === 'string' && block.thinking.length > 0;
        }
        return block.type === 'toolCall'
            && typeof block.id === 'string'
            && typeof block.name === 'string'
            && block.arguments !== null
            && typeof block.arguments === 'object'
            && !Array.isArray(block.arguments);
    }

    private handleAssistantContent(
        block: JsonObject,
        details?: { model: string; usage: AgentUsage }
    ): void {
        switch (block.type) {
            case 'text':
                if (typeof block.text === 'string' && block.text.length > 0) {
                    this.callbacks.onAgentMessage({ type: 'text', text: block.text, ...details });
                }
                return;
            case 'thinking':
                if (typeof block.thinking === 'string' && block.thinking.length > 0) {
                    this.callbacks.onAgentMessage({ type: 'reasoning', text: block.thinking, ...details });
                }
                return;
            case 'toolCall':
                if (
                    typeof block.id === 'string'
                    && typeof block.name === 'string'
                    && block.arguments !== null
                    && typeof block.arguments === 'object'
                    && !Array.isArray(block.arguments)
                ) {
                    this.callbacks.onAgentMessage({
                        type: 'tool_call',
                        id: block.id,
                        name: block.name,
                        input: block.arguments,
                        status: 'pending',
                        ...details
                    });
                }
                return;
            case 'image':
            case 'redactedThinking':
            case 'fallback':
                return;
            default:
                this.callbacks.onDiagnostic(`Unknown OMP assistant content block: ${String(block.type)}`);
        }
    }

    private handleToolStart(raw: JsonObject): void {
        const parsed = ToolStartSchema.safeParse(raw);
        if (!parsed.success) {
            this.invalidEvent('tool_execution_start', parsed.error);
            return;
        }
        this.callbacks.onAgentMessage({
            type: 'tool_call',
            id: parsed.data.toolCallId,
            name: parsed.data.toolName,
            input: parsed.data.args,
            status: 'in_progress'
        });
        this.callbacks.onInkMessage(`Tool call: ${parsed.data.toolName}`, 'tool');
    }

    private handleToolUpdate(raw: JsonObject): void {
        const parsed = ToolUpdateSchema.safeParse(raw);
        if (!parsed.success) {
            this.invalidEvent('tool_execution_update', parsed.error);
            return;
        }
        this.callbacks.onAgentMessage({
            type: 'tool_call',
            id: parsed.data.toolCallId,
            name: parsed.data.toolName,
            input: parsed.data.args,
            status: 'in_progress'
        });
    }

    private handleToolEnd(raw: JsonObject): void {
        const parsed = ToolEndSchema.safeParse(raw);
        if (!parsed.success) {
            this.invalidEvent('tool_execution_end', parsed.error);
            return;
        }
        this.callbacks.onAgentMessage({
            type: 'tool_call',
            id: parsed.data.toolCallId,
            name: parsed.data.toolName,
            input: {},
            status: parsed.data.isError ? 'failed' : 'completed'
        });
    }

    private handleStatusEvent(raw: JsonObject, label: string): void {
        this.callbacks.onInkMessage(`${label}: ${JSON.stringify(raw)}`, 'status');
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

    private textFromContent(content: JsonObject[]): string {
        return content
            .map((block) => block.type === 'text' && typeof block.text === 'string' ? block.text : '')
            .filter(Boolean)
            .join('\n');
    }

    private invalidEvent(type: string, error: z.ZodError): void {
        this.callbacks.onDiagnostic(`Invalid OMP RPC ${type} event: ${error.message}`);
    }
}
