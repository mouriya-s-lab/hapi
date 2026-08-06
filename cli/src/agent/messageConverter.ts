import { randomUUID } from 'node:crypto';
import type { AgentMessage, AgentUsage, PlanItem } from './types';

type CodexUsageInfo = {
    total: {
        inputTokens: number;
        outputTokens: number;
        totalTokens?: number;
        thoughtTokens?: number;
        cachedInputTokens?: number;
        cacheWriteInputTokens?: number;
    };
    contextTokens?: number;
    modelContextWindow?: number;
    costUsd?: number;
};

function convertAgentUsage(message: AgentUsage): CodexUsageInfo {
    return {
        total: {
            inputTokens: message.inputTokens,
            outputTokens: message.outputTokens,
            totalTokens: message.totalTokens,
            thoughtTokens: message.thoughtTokens,
            cachedInputTokens: message.cacheReadTokens,
            cacheWriteInputTokens: message.cacheCreationTokens
        },
        contextTokens: message.contextTokens,
        modelContextWindow: message.contextWindow,
        costUsd: message.costUsd
    };
}

export type CodexMessage =
    | { type: 'message'; message: string; id?: string; streamSnapshot?: boolean; model?: string; usage?: CodexUsageInfo }
    | { type: 'reasoning'; message: string; id: string; model?: string; usage?: CodexUsageInfo }
    | {
        type: 'token_count';
        model: string | null;
        info: CodexUsageInfo;
    }
    | {
        type: 'tool-call';
        name: string;
        callId: string;
        input: unknown;
        status?: 'pending' | 'in_progress' | 'completed' | 'failed';
        nativeTitle?: string;
        nativeKind?: string;
        model?: string;
        usage?: CodexUsageInfo;
        progress?: unknown;
    }
    | {
        type: 'tool-call-result';
        callId: string;
        output: unknown;
        is_error?: boolean;
    }
    | { type: 'plan'; entries: PlanItem[] }
    | { type: 'error'; message: string }
    | {
        type: 'generated-image';
        imageId: string;
        fileName: string;
        mimeType: string;
        id: string;
    };

export function convertAgentMessage(message: AgentMessage, model?: string | null): CodexMessage | null {
    switch (message.type) {
        case 'text':
            return {
                type: 'message',
                message: message.text,
                model: message.model,
                usage: message.usage ? convertAgentUsage(message.usage) : undefined,
                ...(message.id !== undefined ? { id: message.id } : {}),
                ...(message.streamSnapshot === true ? { streamSnapshot: true } : {})
            };
        case 'reasoning':
            // AgentMessage uses `text` (consistent with the `text` variant);
            // the wire-level CodexMessage uses `message` to match the
            // existing reasoning format emitted by the Codex path.
            return {
                type: 'reasoning',
                message: message.text,
                id: message.id ?? randomUUID(),
                model: message.model,
                usage: message.usage ? convertAgentUsage(message.usage) : undefined
            };
        case 'usage':
            return {
                type: 'token_count',
                model: typeof model === 'string' && model.trim() ? model.trim() : null,
                info: {
                    total: {
                        inputTokens: message.inputTokens
                            + (message.cacheReadTokens ?? 0)
                            + (message.cacheCreationTokens ?? 0),
                        outputTokens: message.outputTokens,
                        totalTokens: message.totalTokens,
                        thoughtTokens: message.thoughtTokens,
                        cachedInputTokens: message.cacheReadTokens,
                        ...(message.cacheCreationTokens !== undefined
                            ? { cacheWriteInputTokens: message.cacheCreationTokens }
                            : {})
                    },
                    contextTokens: message.contextTokens,
                    modelContextWindow: message.contextWindow,
                    costUsd: message.costUsd
                }
            };
        case 'tool_call':
            return {
                type: 'tool-call',
                name: message.name,
                callId: message.id,
                input: message.input,
                status: message.status,
                ...(message.title ? { nativeTitle: message.title } : {}),
                ...(message.kind ? { nativeKind: message.kind } : {}),
                model: message.model,
                usage: message.usage ? convertAgentUsage(message.usage) : undefined,
                ...(message.progress !== undefined ? { progress: message.progress } : {})
            };
        case 'tool_result':
            return {
                type: 'tool-call-result',
                callId: message.id,
                output: message.output,
                is_error: message.status === 'failed'
            };
        case 'plan':
            return {
                type: 'plan',
                entries: message.items
            };
        case 'generated_image':
            return {
                type: 'generated-image',
                imageId: message.imageId,
                fileName: message.fileName,
                mimeType: message.mimeType,
                id: randomUUID(),
            };
        case 'error':
            return { type: 'error', message: message.message };
        case 'turn_complete':
            return null;
        default: {
            // Unreachable while every AgentMessage variant is handled above —
            // the `never` binding is what enforces that at compile time. The
            // runtime return is deliberately `null` rather than the message
            // itself: callers forward a non-null result straight into the chat
            // stream, so echoing an unrecognized shape here would put a raw
            // object on screen instead of failing closed.
            const _exhaustive: never = message;
            void _exhaustive;
            return null;
        }
    }
}
