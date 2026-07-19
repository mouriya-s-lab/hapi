import { describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@/agent/types';
import type { RawJSONLines } from '@/claude/types';
import { OMP_KNOWN_EVENT_TYPES } from './types';
import type { OmpAgentRunEvent, OmpRpcEventAdapterCallbacks, OmpStructuredEvent } from './OmpRpcEventAdapter';
import { OmpRpcEventAdapter } from './OmpRpcEventAdapter';
import { parseOmpInboundLine } from './schemas';

function rpcEvent(frame: Record<string, unknown>) {
    const parsed = parseOmpInboundLine(JSON.stringify(frame));
    if (parsed.kind !== 'event') throw new Error(`Expected event, received ${parsed.kind}`);
    return parsed.event;
}

function assistantMessage(text: string, responseId?: string) {
    return {
        role: 'assistant',
        content: [
            { type: 'thinking', thinking: `reasoning:${text}` },
            { type: 'text', text }
        ],
        provider: 'test-provider',
        model: 'test-model',
        responseId,
        usage: {
            input: 11,
            output: 7,
            cacheRead: 3,
            cacheWrite: 2,
            totalTokens: 23,
            reasoningTokens: 5,
            cost: { input: 0.01, output: 0.02, cacheRead: 0.003, cacheWrite: 0.002, total: 0.035 }
        },
        stopReason: 'stop'
    };
}

function createHarness() {
    const canonicalMessages: RawJSONLines[] = [];
    const agentMessages: AgentMessage[] = [];
    const agentRunEvents: OmpAgentRunEvent[] = [];
    const traces: Array<{
        scope: Parameters<OmpRpcEventAdapterCallbacks['onAgentRunTrace']>[0];
        message: AgentMessage;
    }> = [];
    const structuredEvents: OmpStructuredEvent[] = [];
    const hostEvents: Parameters<OmpRpcEventAdapterCallbacks['onHostEvent']>[0][] = [];
    const availableCommands: Parameters<OmpRpcEventAdapterCallbacks['onAvailableCommandsChanged']>[0][] = [];
    const diagnostics: string[] = [];
    const callbacks: OmpRpcEventAdapterCallbacks = {
        onAgentMessage: (message) => agentMessages.push(message),
        onCanonicalMessage: (message) => canonicalMessages.push(message),
        onAgentRunEvent: (event) => agentRunEvents.push(event),
        onAgentRunTrace: (scope, message) => traces.push({ scope, message }),
        onStructuredEvent: (event) => structuredEvents.push(event),
        onInkMessage: vi.fn(),
        onUserMessageCommitted: vi.fn(),
        onTurnStarted: vi.fn(),
        onTurnFinished: vi.fn(),
        onPromptResult: vi.fn(),
        onSessionInfoUpdate: vi.fn(),
        onAvailableCommandsChanged: (commands) => availableCommands.push(commands),
        onThinkingStateChanged: vi.fn(),
        onDiagnostic: (message) => diagnostics.push(message),
        onHostEvent: (event) => hostEvents.push(event)
    };
    return {
        adapter: new OmpRpcEventAdapter(callbacks),
        callbacks,
        canonicalMessages,
        agentMessages,
        agentRunEvents,
        traces,
        structuredEvents,
        hostEvents,
        availableCommands,
        diagnostics
    };
}

describe('OmpRpcEventAdapter', () => {
    it('forwards the complete dynamic command catalog through a typed callback', () => {
        const harness = createHarness();
        harness.adapter.handle(rpcEvent({
            type: 'available_commands_update',
            commands: [{
                name: 'review',
                aliases: ['rv'],
                description: 'Review changes',
                input: { hint: 'path' },
                subcommands: [{ name: 'staged', usage: '/review staged' }],
                source: 'extension'
            }]
        }));

        expect(harness.availableCommands).toEqual([[
            {
                name: 'review',
                aliases: ['rv'],
                description: 'Review changes',
                input: { hint: 'path' },
                subcommands: [{ name: 'staged', usage: '/review staged' }],
                source: 'extension'
            }
        ]]);
        expect(harness.callbacks.onSessionInfoUpdate).not.toHaveBeenCalled();
    });

    it('commits one canonical assistant snapshot with separate display/provider IDs and native usage', () => {
        const harness = createHarness();
        const initial = assistantMessage('initial', 'provider-response-1');
        harness.adapter.handle(rpcEvent({ type: 'message_start', message: initial }));
        harness.adapter.handle(rpcEvent({
            type: 'message_update',
            message: assistantMessage('streamed', 'provider-response-1'),
            assistantMessageEvent: { type: 'text_delta', delta: 'streamed' }
        }));
        harness.adapter.handle(rpcEvent({
            type: 'message_end',
            message: assistantMessage('final', 'provider-response-1')
        }));

        expect(harness.canonicalMessages).toHaveLength(1);
        const committed = harness.canonicalMessages[0];
        if (committed.type !== 'assistant') throw new Error(`Expected assistant, received ${committed.type}`);
        expect(committed.uuid).not.toBe('provider-response-1');
        expect(committed.providerMessageId).toBe('provider-response-1');
        expect(committed.message).toMatchObject({
            model: 'test-provider/test-model',
            content: [
                { type: 'thinking', thinking: 'reasoning:final' },
                { type: 'text', text: 'final' }
            ],
            usage: {
                input_tokens: 11,
                output_tokens: 7,
                reasoning_output_tokens: 5,
                cost_usd: 0.035
            }
        });
        expect(harness.agentMessages).toContainEqual({
            type: 'usage',
            inputTokens: 11,
            outputTokens: 7,
            totalTokens: 23,
            thoughtTokens: 5,
            cacheReadTokens: 3,
            costUsd: 0.035
        });
    });

    it('keeps one tool card identity through start/update/end and commits only the message_end result', () => {
        const harness = createHarness();
        harness.adapter.handle(rpcEvent({
            type: 'tool_execution_start',
            toolCallId: 'tool-1',
            toolName: 'bash',
            args: { command: 'printf start' }
        }));
        harness.adapter.handle(rpcEvent({
            type: 'tool_execution_update',
            toolCallId: 'tool-1',
            toolName: 'bash',
            args: { command: 'mutated update args' },
            partialResult: { content: 'partial' }
        }));
        harness.adapter.handle(rpcEvent({
            type: 'tool_execution_end',
            toolCallId: 'tool-1',
            toolName: 'bash',
            result: { content: 'execution end' },
            isError: false
        }));
        harness.adapter.handle(rpcEvent({
            type: 'message_start',
            message: {
                role: 'toolResult',
                toolCallId: 'tool-1',
                toolName: 'bash',
                content: [{ type: 'text', text: 'canonical result' }],
                isError: false
            }
        }));
        harness.adapter.handle(rpcEvent({
            type: 'message_end',
            message: {
                role: 'toolResult',
                toolCallId: 'tool-1',
                toolName: 'bash',
                content: [{ type: 'text', text: 'canonical result' }],
                details: { exitCode: 0 },
                isError: false
            }
        }));

        const lifecycle = harness.agentMessages.filter((message) => message.type === 'tool_call');
        expect(lifecycle).toHaveLength(3);
        expect(lifecycle.map((message) => message.id)).toEqual(['tool-1', 'tool-1', 'tool-1']);
        expect(lifecycle.map((message) => message.input)).toEqual([
            { command: 'printf start' },
            { command: 'printf start' },
            { command: 'printf start' }
        ]);
        expect(harness.agentMessages.some((message) => message.type === 'tool_result')).toBe(false);
        expect(harness.canonicalMessages).toHaveLength(1);
        expect(harness.canonicalMessages[0]).toMatchObject({
            type: 'user',
            message: {
                content: [{
                    type: 'tool_result',
                    tool_use_id: 'tool-1',
                    content: {
                        content: [{ type: 'text', text: 'canonical result' }],
                        details: { exitCode: 0 }
                    },
                    is_error: false
                }]
            }
        });
    });

    it('owns two OMP subagents with stable cards, exact retry state, child traces, and terminal results', () => {
        const harness = createHarness();
        for (const [index, id] of ['alpha', 'beta'].entries()) {
            harness.adapter.handle(rpcEvent({
                type: 'subagent_lifecycle',
                payload: {
                    id,
                    agent: 'task',
                    agentSource: 'bundled',
                    description: `worker ${id}`,
                    status: 'started',
                    parentToolCallId: 'task-parent',
                    index
                }
            }));
        }
        harness.adapter.handle(rpcEvent({
            type: 'subagent_progress',
            payload: {
                index: 0,
                agent: 'task',
                agentSource: 'bundled',
                task: 'alpha work',
                parentToolCallId: 'task-parent',
                progress: {
                    id: 'alpha',
                    status: 'running',
                    retryState: {
                        attempt: 2,
                        maxAttempts: 4,
                        delayMs: 1500,
                        errorMessage: 'rate limited',
                        startedAtMs: 123456
                    }
                }
            }
        }));
        for (const id of ['alpha', 'beta']) {
            harness.adapter.handle(rpcEvent({
                type: 'subagent_event',
                payload: {
                    id,
                    event: { type: 'message_end', message: assistantMessage(`${id} final`) }
                }
            }));
            harness.adapter.handle(rpcEvent({
                type: 'subagent_lifecycle',
                payload: {
                    id,
                    agent: 'task',
                    agentSource: 'bundled',
                    description: `worker ${id}`,
                    status: 'completed',
                    parentToolCallId: 'task-parent',
                    index: id === 'alpha' ? 0 : 1
                }
            }));
        }

        const starts = harness.agentRunEvents.filter((event) => event.type === 'agent-run-start');
        expect(starts.map((event) => event.cardId)).toEqual([
            'omp-subagent:alpha',
            'omp-subagent:beta'
        ]);
        expect(starts.every((event) => event.parentToolCallId === 'task-parent')).toBe(true);
        const retry = harness.agentRunEvents.find((event) => (
            event.type === 'agent-run-update' && event.retryState !== undefined
        ));
        expect(retry).toMatchObject({
            agentId: 'alpha',
            retryState: {
                attempt: 2,
                maxAttempts: 4,
                delayMs: 1500,
                errorMessage: 'rate limited',
                startedAtMs: 123456
            }
        });
        expect(JSON.stringify(retry)).not.toContain('reset');
        expect(harness.traces.filter((trace) => trace.message.type === 'text')).toEqual([
            expect.objectContaining({ scope: expect.objectContaining({ agentId: 'alpha', cardId: 'omp-subagent:alpha' }) }),
            expect.objectContaining({ scope: expect.objectContaining({ agentId: 'beta', cardId: 'omp-subagent:beta' }) })
        ]);
        const terminal = harness.agentRunEvents.filter((event) => (
            event.type === 'agent-run-update' && event.status === 'completed'
        ));
        expect(terminal).toEqual(expect.arrayContaining([
            expect.objectContaining({ agentId: 'alpha', result: 'alpha final' }),
            expect.objectContaining({ agentId: 'beta', result: 'beta final' })
        ]));
    });

    it('keeps subagent tool identity and original arguments through execution and canonical result', () => {
        const harness = createHarness();
        harness.adapter.handle(rpcEvent({
            type: 'subagent_lifecycle',
            payload: {
                id: 'alpha',
                agent: 'task',
                agentSource: 'bundled',
                status: 'started',
                parentToolCallId: 'task-parent',
                index: 0
            }
        }));
        for (const event of [
            {
                type: 'tool_execution_start',
                toolCallId: 'child-tool',
                toolName: 'bash',
                args: { command: 'printf original' }
            },
            {
                type: 'tool_execution_update',
                toolCallId: 'child-tool',
                toolName: 'bash',
                args: { command: 'mutated update args' },
                partialResult: { content: 'partial' }
            },
            {
                type: 'tool_execution_end',
                toolCallId: 'child-tool',
                toolName: 'bash',
                result: { content: 'execution result' },
                isError: false
            }
        ]) {
            harness.adapter.handle(rpcEvent({
                type: 'subagent_event',
                payload: { id: 'alpha', event }
            }));
        }
        harness.adapter.handle(rpcEvent({
            type: 'subagent_event',
            payload: {
                id: 'alpha',
                event: {
                    type: 'message_end',
                    message: {
                        role: 'toolResult',
                        toolCallId: 'child-tool',
                        toolName: 'bash',
                        content: [{ type: 'text', text: 'canonical result' }],
                        isError: false
                    }
                }
            }
        }));

        const childLifecycle = harness.traces
            .map((trace) => trace.message)
            .filter((message) => message.type === 'tool_call');
        expect(childLifecycle.map((message) => message.id)).toEqual([
            'child-tool',
            'child-tool',
            'child-tool'
        ]);
        expect(childLifecycle.map((message) => message.input)).toEqual([
            { command: 'printf original' },
            { command: 'printf original' },
            { command: 'printf original' }
        ]);
        expect(harness.traces.map((trace) => trace.message)).toContainEqual({
            type: 'tool_result',
            id: 'child-tool',
            output: {
                content: [{ type: 'text', text: 'canonical result' }],
                details: undefined
            },
            status: 'completed'
        });
    });

    it('uses a successful task yield as the subagent result when no assistant text exists', () => {
        const harness = createHarness();
        harness.adapter.handle(rpcEvent({
            type: 'subagent_lifecycle',
            payload: {
                id: 'alpha',
                agent: 'task',
                agentSource: 'bundled',
                status: 'started',
                parentToolCallId: 'task-parent',
                index: 0
            }
        }));
        harness.adapter.handle(rpcEvent({
            type: 'subagent_progress',
            payload: {
                index: 0,
                agent: 'task',
                agentSource: 'bundled',
                task: 'alpha work',
                parentToolCallId: 'task-parent',
                progress: {
                    id: 'alpha',
                    status: 'completed',
                    extractedToolData: {
                        yield: [
                            { data: 'ignored failure', status: 'error' },
                            { data: 'alpha yielded final', status: 'success' }
                        ]
                    }
                }
            }
        }));
        harness.adapter.handle(rpcEvent({
            type: 'subagent_lifecycle',
            payload: {
                id: 'alpha',
                agent: 'task',
                agentSource: 'bundled',
                status: 'completed',
                parentToolCallId: 'task-parent',
                index: 0
            }
        }));

        const completed = harness.agentRunEvents.filter((event) => (
            event.type === 'agent-run-update' && event.status === 'completed'
        ));
        expect(completed).toHaveLength(2);
        expect(completed).toEqual(expect.arrayContaining([
            expect.objectContaining({ agentId: 'alpha', result: 'alpha yielded final' })
        ]));
    });

    it('preserves unknown frames and emits controlled structured diagnostics', () => {
        const harness = createHarness();
        expect(OMP_KNOWN_EVENT_TYPES).toHaveLength(37);
        harness.adapter.handle(rpcEvent({
            type: 'future_event',
            nested: { future: true },
            version: 18
        }));

        expect(harness.structuredEvents).toEqual([{
            type: 'omp-rpc-warning',
            eventType: 'future_event',
            warning: 'Unknown OMP RPC event: future_event',
            frame: {
                type: 'future_event',
                nested: { future: true },
                version: 18
            }
        }]);
        expect(harness.diagnostics).toEqual(['Unknown OMP RPC event: future_event']);
    });
});
