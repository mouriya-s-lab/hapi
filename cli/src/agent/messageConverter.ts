import { randomUUID } from 'node:crypto';
import type { AgentMessage, AgentUsage, PlanItem } from './types';

type CodexUsageInfo = {
    total: {
        inputTokens: number;
        outputTokens: number;
        totalTokens?: number;
        thoughtTokens?: number;
        cachedInputTokens?: number;
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
            cachedInputTokens: message.cacheReadTokens
        },
        contextTokens: message.contextTokens,
        modelContextWindow: message.contextWindow,
        costUsd: message.costUsd
    };
}

export type CodexMessage =
    | { type: 'message'; message: string; model?: string; usage?: CodexUsageInfo }
    | { type: 'reasoning'; message: string; id: string; model?: string; usage?: CodexUsageInfo }
    | {
        type: 'token_count';
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

export function convertAgentMessage(message: AgentMessage): CodexMessage | null {
    switch (message.type) {
        case 'text':
            return {
                type: 'message',
                message: message.text,
                model: message.model,
                usage: message.usage ? convertAgentUsage(message.usage) : undefined
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
                info: convertAgentUsage(message)
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
                usage: message.usage ? convertAgentUsage(message.usage) : undefined
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
            const _exhaustive: never = message;
            return _exhaustive;
        }
    }
}
