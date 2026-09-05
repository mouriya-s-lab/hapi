import { describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@/agent/types';
import type { RawJSONLines } from '@/claude/types';
import type { JsonObject, OmpKnownEventType } from './types';
import type { OmpAgentRunEvent, OmpRpcEventAdapterCallbacks, OmpStructuredEvent } from './OmpRpcEventAdapter';
import { OmpRpcEventAdapter } from './OmpRpcEventAdapter';
import { parseOmpInboundLine } from './schemas';

function rpcEvent(frame: Record<string, unknown>) {
    const parsed = parseOmpInboundLine(JSON.stringify(frame));
    if (parsed.kind !== 'event') throw new Error(`Expected event, received ${parsed.kind}`);
    return parsed.event;
}

function assistantMessage(text: string, responseId?: string): JsonObject {
    return {
        role: 'assistant',
        content: [
            { type: 'thinking', thinking: `reasoning:${text}` },
            { type: 'text', text }
        ],
        provider: 'test-provider',
        model: 'test-model',
        ...(responseId === undefined ? {} : { responseId }),
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

function createHarness(eventAllowlist?: ReadonlySet<OmpKnownEventType>) {
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
        adapter: new OmpRpcEventAdapter(callbacks, eventAllowlist),
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
            cacheCreationTokens: 2,
            costUsd: 0.035
        });
    });

    it('stamps the canonical assistant with commit time, not the omp turn-start timestamp', () => {
        // Regression: omp's message timestamp is the turn/model-request start.
        // Forwarding it made the hub sort the first assistant message of a turn
        // ABOVE the user's prompt whenever the runner clock lagged the hub clock.
        const harness = createHarness();
        const turnStart = Date.now() - 10_000;
        const message = { ...assistantMessage('final', 'provider-response-1'), timestamp: turnStart };
        harness.adapter.handle(rpcEvent({ type: 'message_start', message }));
        harness.adapter.handle(rpcEvent({ type: 'message_end', message }));

        const committed = harness.canonicalMessages[0];
        if (committed.type !== 'assistant') throw new Error(`Expected assistant, received ${committed.type}`);
        expect(Date.parse(committed.timestamp ?? '')).toBeGreaterThanOrEqual(turnStart + 9_000);
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

    it('summarizes compaction events without forwarding snapcompact payloads', () => {
        const harness = createHarness();
        harness.adapter.handle(rpcEvent({
            type: 'auto_compaction_start',
            reason: 'threshold',
            action: 'snapcompact'
        }));
        harness.adapter.handle(rpcEvent({
            type: 'auto_compaction_end',
            action: 'snapcompact',
            aborted: false,
            willRetry: false,
            result: {
                shortSummary: 'Archived conversation history',
                tokensBefore: 182_000,
                preserveData: {
                    snapcompact: {
                        frames: [
                            { data: 'iVBORw0KGgo=', mimeType: 'image/png' },
                            { data: 'another-frame', mimeType: 'image/png' }
                        ],
                        totalChars: 217_555,
                        truncatedChars: 1_024,
                        text: 'archived conversation source'
                    }
                }
            }
        }));

        expect(harness.structuredEvents).toEqual([
            {
                type: 'omp-compaction',
                phase: 'started',
                action: 'snapcompact',
                reason: 'threshold'
            },
            {
                type: 'omp-compaction',
                phase: 'finished',
                action: 'snapcompact',
                willRetry: false,
                outcome: 'completed',
                result: {
                    shortSummary: 'Archived conversation history',
                    tokensBefore: 182_000,
                    archive: {
                        frameCount: 2,
                        totalChars: 217_555,
                        truncatedChars: 1_024
                    }
                }
            }
        ]);
        expect(JSON.stringify(harness.structuredEvents)).not.toContain('iVBORw0KGgo');
        expect(JSON.stringify(harness.structuredEvents)).not.toContain('archived conversation source');
    });

    it('preserves the fallback reason when OMP skips shake compaction', () => {
        const harness = createHarness();
        harness.adapter.handle(rpcEvent({
            type: 'auto_compaction_end',
            action: 'shake',
            aborted: false,
            willRetry: false,
            skipped: true,
            errorMessage: 'Auto-shake found nothing eligible to drop; falling back to context-full compaction.'
        }));

        expect(harness.structuredEvents).toEqual([{
            type: 'omp-compaction',
            phase: 'finished',
            action: 'shake',
            willRetry: false,
            outcome: 'skipped',
            message: 'Auto-shake found nothing eligible to drop; falling back to context-full compaction.'
        }]);
    });

    it('forwards model_changed as a session event instead of an unknown warning', () => {
        const harness = createHarness(new Set(['model_changed']));
        harness.adapter.handle(rpcEvent({ type: 'model_changed' }));

        expect(harness.structuredEvents).toEqual([{
            type: 'omp-session-event',
            eventType: 'model_changed',
            frame: { type: 'model_changed' }
        }]);
        expect(harness.diagnostics).toEqual([]);
        expect(harness.callbacks.onSessionInfoUpdate).toHaveBeenCalledOnce();
    });
    it('forwards rpc_frame_error as a readable transport warning', () => {
        const harness = createHarness();
        harness.adapter.handle(rpcEvent({
            type: 'rpc_frame_error',
            originalType: 'message_end',
            error: 'RPC frame exceeded the transport limit'
        }));

        expect(harness.structuredEvents).toEqual([{
            type: 'omp-rpc-warning',
            eventType: 'message_end',
            warning: 'OMP frame too large: message end',
            frame: {
                type: 'rpc_frame_error',
                originalType: 'message_end',
                error: 'RPC frame exceeded the transport limit'
            }
        }]);
        expect(harness.diagnostics).toEqual(['OMP rpc_frame_error: RPC frame exceeded the transport limit']);
    });

    it('keeps future events diagnostic without creating timeline warnings', () => {
        const harness = createHarness();
        harness.adapter.handle(rpcEvent({
            type: 'future_event',
            nested: { future: true },
            version: 18
        }));

        expect(harness.structuredEvents).toEqual([]);
        expect(harness.diagnostics).toEqual(['OMP event: future_event']);
    });

    it('keeps native control and accumulators working with no timeline output', () => {
        const harness = createHarness(new Set());
        for (const text of ['first', 'second']) {
            harness.adapter.handle(rpcEvent({ type: 'agent_start' }));
            harness.adapter.handle(rpcEvent({ type: 'message_start', message: assistantMessage(text) }));
            harness.adapter.handle(rpcEvent({ type: 'message_update', message: assistantMessage(text),
                assistantMessageEvent: { type: 'text_delta', delta: text } }));
            harness.adapter.handle(rpcEvent({ type: 'message_end', message: assistantMessage(text) }));
            harness.adapter.handle(rpcEvent({ type: 'message_end', message: { role: 'user', steering: false } }));
            harness.adapter.handle(rpcEvent({ type: 'tool_execution_start', toolCallId: text, toolName: 'read', args: {} }));
            harness.adapter.handle(rpcEvent({ type: 'tool_execution_end', toolCallId: text, toolName: 'read', result: {} }));
            harness.adapter.handle(rpcEvent({ type: 'agent_end' }));
        }
        harness.adapter.handle(rpcEvent({ type: 'prompt_result', agentInvoked: false }));
        harness.adapter.handle(rpcEvent({ type: 'available_commands_update', commands: [{ name: 'review', source: 'extension' }] }));
        harness.adapter.handle(rpcEvent({ type: 'thinking_level_changed', thinkingLevel: 'high' }));
        harness.adapter.handle(rpcEvent({ type: 'config_update' }));
        harness.adapter.handle(rpcEvent({ type: 'host_tool_cancel', id: 'cancel', targetId: 'call' }));
        expect(harness.canonicalMessages).toEqual([]);
        expect(harness.agentMessages).toEqual([]);
        expect(harness.agentRunEvents).toEqual([]);
        expect(harness.traces).toEqual([]);
        expect(harness.structuredEvents).toEqual([]);
        expect(harness.callbacks.onInkMessage).toHaveBeenCalledWith('first', 'assistant');
        expect(harness.callbacks.onInkMessage).toHaveBeenCalledWith('second', 'assistant');
        expect(harness.callbacks.onTurnStarted).toHaveBeenCalledTimes(2);
        expect(harness.callbacks.onTurnFinished).toHaveBeenCalledTimes(2);
        expect(harness.callbacks.onUserMessageCommitted).toHaveBeenCalledTimes(2);
        expect(harness.callbacks.onPromptResult).toHaveBeenCalledWith(false);
        expect(harness.callbacks.onThinkingStateChanged).toHaveBeenCalledWith({ thinkingLevel: 'high' });
        expect(harness.callbacks.onSessionInfoUpdate).toHaveBeenCalledOnce();
        expect(harness.availableCommands).toEqual([[{ name: 'review', source: 'extension' }]]);
        expect(harness.hostEvents).toEqual([{ type: 'host_tool_cancel', raw: {
            type: 'host_tool_cancel', id: 'cancel', targetId: 'call'
        } }]);
    });

    it('projects selected state and stream events without requiring final messages', () => {
        const harness = createHarness(new Set(['message_start', 'message_update', 'available_commands_update']));
        const frames = [
            { type: 'message_start', message: assistantMessage('start') },
            { type: 'message_update', message: assistantMessage('delta'),
                assistantMessageEvent: { type: 'text_delta', delta: 'delta' } },
            { type: 'available_commands_update', commands: [{ name: 'review', source: 'extension' }] }
        ];
        for (const frame of frames) harness.adapter.handle(rpcEvent(frame));
        harness.adapter.handle(rpcEvent({ type: 'message_end', message: assistantMessage('hidden') }));
        expect(harness.structuredEvents).toEqual(frames.map((frame) => ({
            type: 'omp-session-event', eventType: frame.type, frame
        })));
        expect(harness.canonicalMessages).toEqual([]);
    });

    it('reconstructs a selected tool end from excluded start and update events', () => {
        const harness = createHarness(new Set(['tool_execution_end']));
        harness.adapter.handle(rpcEvent({ type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'read',
            args: { path: 'file.ts' } }));
        harness.adapter.handle(rpcEvent({ type: 'tool_execution_update', toolCallId: 'read-1', toolName: 'read',
            args: {}, partialResult: { text: 'partial' } }));
        harness.adapter.handle(rpcEvent({ type: 'tool_execution_end', toolCallId: 'read-1', toolName: 'read',
            result: { text: 'complete' } }));
        expect(harness.agentMessages).toEqual([{
            type: 'tool_call', id: 'read-1', name: 'read', input: { path: 'file.ts' }, status: 'completed'
        }]);
        expect(harness.structuredEvents).toEqual([]);
    });

    it('applies envelope policy to seeded cards and replay, not nested event names', () => {
        const hidden = createHarness(new Set());
        const replayOnly = createHarness(new Set(['subagent_event']));
        for (const harness of [hidden, replayOnly]) {
            harness.adapter.seedSubagents([{
                id: 'alpha', index: 0, agent: 'task', agentSource: 'bundled',
                status: 'running', lastUpdate: 123, progress: { id: 'alpha', status: 'running' }
            }]);
            expect(harness.agentRunEvents).toEqual([]);
            harness.adapter.seedSubagentMessages('alpha', [assistantMessage('replayed', 'replay-id')]);
            harness.adapter.handle(rpcEvent({ type: 'subagent_event', payload: {
                id: 'alpha', event: { type: 'tool_execution_start', toolCallId: 'child', toolName: 'read',
                    args: { path: 'child.ts' } }
            } }));
        }
        expect(hidden.agentRunEvents).toEqual([]);
        expect(hidden.traces).toEqual([]);
        expect(hidden.structuredEvents).toEqual([]);
        expect(replayOnly.agentRunEvents).toEqual([expect.objectContaining({
            type: 'agent-run-start', agentId: 'alpha', cardId: 'omp-subagent:alpha'
        })]);
        expect(replayOnly.traces.map((trace) => trace.message)).toEqual([
            expect.objectContaining({ type: 'reasoning', text: 'reasoning:replayed' }),
            expect.objectContaining({ type: 'text', text: 'replayed' }),
            expect.objectContaining({ type: 'tool_call', id: 'child', input: { path: 'child.ts' } })
        ]);
        expect(replayOnly.structuredEvents).toEqual([]);
    });

    it('does not replace intentionally silent rich projections with generic timeline rows', () => {
        const harness = createHarness(new Set(['message_end', 'subagent_lifecycle', 'subagent_event']));
        harness.adapter.handle(rpcEvent({ type: 'message_end', message: { role: 'user', steering: false } }));
        harness.adapter.handle(rpcEvent({ type: 'message_end', message: { role: 'developer', content: 'context' } }));
        const lifecycle = { type: 'subagent_lifecycle', payload: {
            id: 'alpha', index: 0, agent: 'task', agentSource: 'bundled', status: 'started'
        } };
        harness.adapter.handle(rpcEvent(lifecycle));
        harness.adapter.handle(rpcEvent(lifecycle));
        harness.adapter.seedSubagentMessages('alpha', [assistantMessage('replayed', 'same-response')]);
        harness.adapter.handle(rpcEvent({ type: 'subagent_event', payload: {
            id: 'alpha', event: { type: 'message_end', message: assistantMessage('replayed', 'same-response') }
        } }));
        expect(harness.structuredEvents).toEqual([]);
        expect(harness.canonicalMessages).toEqual([]);
        expect(harness.agentRunEvents).toEqual([expect.objectContaining({
            type: 'agent-run-start', agentId: 'alpha'
        })]);
        expect(harness.traces.map((trace) => trace.message)).toEqual([
            expect.objectContaining({ type: 'reasoning', text: 'reasoning:replayed' }),
            expect.objectContaining({ type: 'text', text: 'replayed' })
        ]);
    });

    it('keeps nested stream and state events quiet while retaining final child traces', () => {
        const visible = createHarness();
        const hidden = createHarness(new Set());
        const childEvents: JsonObject[] = [
            { type: 'message_start', message: assistantMessage('partial') },
            { type: 'message_update', message: assistantMessage('partial'),
                assistantMessageEvent: { type: 'text_delta', delta: 'partial' } },
            { type: 'message_update', message: assistantMessage('final'),
                assistantMessageEvent: { type: 'done', message: assistantMessage('final') } },
            { type: 'advisor_yielded' },
            { type: 'config_warnings_changed' },
            { type: 'turn_end', message: assistantMessage('final'), toolResults: [] },
            { type: 'message_end', message: assistantMessage('final', 'child-final') },
            { type: 'tool_execution_start', toolCallId: 'read-child', toolName: 'read', args: { path: 'child.ts' } },
            { type: 'tool_execution_end', toolCallId: 'read-child', toolName: 'read',
                result: { content: [{ type: 'text', text: 'read output' }] }, isError: false }
        ];
        for (const harness of [visible, hidden]) {
            harness.adapter.handle(rpcEvent({ type: 'subagent_lifecycle', payload: {
                id: 'alpha', index: 0, agent: 'task', agentSource: 'bundled', status: 'started'
            } }));
            for (const event of childEvents) {
                harness.adapter.handle(rpcEvent({ type: 'subagent_event', payload: { id: 'alpha', event } }));
            }
            expect(harness.structuredEvents).toEqual([]);
            expect(harness.canonicalMessages).toEqual([]);
            expect(harness.agentMessages).toEqual([]);
        }
        expect(visible.traces.map((trace) => trace.message)).toEqual([
            expect.objectContaining({ type: 'reasoning', text: 'reasoning:final' }),
            expect.objectContaining({ type: 'text', text: 'final' }),
            { type: 'tool_call', id: 'read-child', name: 'read', input: { path: 'child.ts' }, status: 'in_progress' },
            { type: 'tool_call', id: 'read-child', name: 'read', input: { path: 'child.ts' }, status: 'completed' }
        ]);
        expect(hidden.traces).toEqual([]);
        expect(hidden.agentRunEvents).toEqual([]);
    });

    it('keeps native streaming visible locally when default policy excludes hub stream events', () => {
        const harness = createHarness();
        harness.adapter.handle(rpcEvent({ type: 'message_start', message: assistantMessage('initial') }));
        harness.adapter.handle(rpcEvent({
            type: 'message_update', message: assistantMessage('streamed'),
            assistantMessageEvent: { type: 'thinking_delta', delta: 'considering' }
        }));
        harness.adapter.handle(rpcEvent({
            type: 'message_update', message: assistantMessage('streamed'),
            assistantMessageEvent: { type: 'text_delta', delta: 'streamed' }
        }));
        expect(harness.callbacks.onInkMessage).toHaveBeenCalledWith('[Thinking] considering', 'system');
        expect(harness.callbacks.onInkMessage).toHaveBeenCalledWith('streamed', 'assistant');
        expect(harness.structuredEvents).toEqual([]);
        expect(harness.canonicalMessages).toEqual([]);
        expect(harness.agentMessages).toEqual([]);
        harness.adapter.handle(rpcEvent({ type: 'message_end', message: assistantMessage('final') }));
        expect(harness.canonicalMessages).toEqual([expect.objectContaining({
            type: 'assistant', message: expect.objectContaining({
                content: [
                    { type: 'thinking', thinking: 'reasoning:final' },
                    { type: 'text', text: 'final' }
                ]
            })
        })]);
        expect(harness.structuredEvents).toEqual([]);
    });
});
