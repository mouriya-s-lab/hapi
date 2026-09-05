import { describe, expect, it } from 'vitest';
import { parseOmpInboundLine, parseOmpResponseData } from './schemas';
import type { JsonValue, OmpCommandType } from './types';

const MODEL = {
    id: 'model-1',
    name: 'Model One',
    api: 'openai-completions',
    provider: 'provider-1',
    baseUrl: 'https://api.example.test',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 128_000,
    maxTokens: 16_384,
    thinking: {
        mode: 'levels',
        efforts: ['minimal', 'low', 'high', 'xhigh'],
        defaultLevel: 'high'
    }
} satisfies JsonValue;

const STATE = {
    model: MODEL,
    thinkingLevel: 'off',
    isStreaming: false,
    isCompacting: false,
    steeringMode: 'all',
    followUpMode: 'one-at-a-time',
    interruptMode: 'wait',
    sessionFile: '/home/user/session.jsonl',
    sessionId: 'session-1',
    sessionName: 'Session one',
    autoCompactionEnabled: true,
    messageCount: 2,
    queuedMessageCount: 0,
    todoPhases: [],
    systemPrompt: ['system'],
    dumpTools: [],
    contextUsage: { tokens: 100, contextWindow: 128_000, percent: 0.078125 }
} satisfies JsonValue;

const DECODED_MODEL = { ...MODEL, raw: MODEL };

const RESPONSE_CASES: ReadonlyArray<{
    command: OmpCommandType;
    data?: JsonValue;
    expected?: JsonValue;
}> = [
    { command: 'prompt', data: { agentInvoked: true } },
    { command: 'steer' },
    { command: 'follow_up' },
    { command: 'abort' },
    { command: 'abort_and_prompt' },
    { command: 'new_session', data: { cancelled: false } },
    { command: 'get_state', data: STATE, expected: { ...STATE, model: DECODED_MODEL } },
    { command: 'get_available_commands', data: { commands: [{ name: 'help', source: 'built-in' }] } },
    { command: 'set_todos', data: { todoPhases: [] } },
    { command: 'set_host_tools', data: { toolNames: ['display_image'] } },
    { command: 'set_host_uri_schemes', data: { schemes: [] } },
    { command: 'set_subagent_subscription', data: { level: 'events' } },
    {
        command: 'get_subagents',
        data: {
            subagents: [{
                id: 'subagent-1',
                index: 0,
                agent: 'explore',
                agentSource: 'built-in',
                status: 'running',
                lastUpdate: 1
            }]
        }
    },
    {
        command: 'get_subagent_messages',
        data: {
            sessionFile: '/home/user/subagent.jsonl',
            fromByte: 0,
            nextByte: 10,
            reset: false,
            entries: [],
            messages: [{ role: 'assistant', content: [] }]
        },
        expected: {
            sessionFile: '/home/user/subagent.jsonl',
            fromByte: 0,
            nextByte: 10,
            reset: false,
            entries: [],
            messages: [{ role: 'assistant', raw: { role: 'assistant', content: [] } }]
        }
    },
    { command: 'set_model', data: MODEL, expected: DECODED_MODEL },
    {
        command: 'cycle_model',
        data: { model: MODEL, thinkingLevel: 'inherit', isScoped: false },
        expected: { model: DECODED_MODEL, thinkingLevel: 'inherit', isScoped: false }
    },
    { command: 'get_available_models', data: { models: [MODEL] }, expected: { models: [DECODED_MODEL] } },
    { command: 'set_thinking_level' },
    { command: 'cycle_thinking_level', data: { level: 'auto' } },
    { command: 'set_steering_mode' },
    { command: 'set_follow_up_mode' },
    { command: 'set_interrupt_mode' },
    {
        command: 'compact',
        data: {
            summary: 'summary',
            firstKeptEntryId: 'entry-1',
            tokensBefore: 1000
        }
    },
    { command: 'set_auto_compaction' },
    { command: 'set_auto_retry' },
    { command: 'abort_retry' },
    {
        command: 'bash',
        data: {
            output: 'done',
            exitCode: 0,
            cancelled: false,
            truncated: false,
            totalLines: 1,
            totalBytes: 4,
            outputLines: 1,
            outputBytes: 4
        }
    },
    { command: 'abort_bash' },
    {
        command: 'get_session_stats',
        data: {
            sessionFile: '/home/user/session.jsonl',
            sessionId: 'session-1',
            userMessages: 1,
            assistantMessages: 1,
            toolCalls: 0,
            toolResults: 0,
            totalMessages: 2,
            tokens: {
                input: 10,
                output: 20,
                reasoning: 5,
                cacheRead: 0,
                cacheWrite: 0,
                total: 35
            },
            premiumRequests: 0,
            cost: 0.01
        }
    },
    { command: 'export_html', data: { path: '/home/user/export.html' } },
    { command: 'switch_session', data: { cancelled: false } },
    { command: 'branch', data: { text: 'branched', cancelled: false } },
    { command: 'get_branch_messages', data: { messages: [{ entryId: 'entry-1', text: 'hello' }] } },
    { command: 'get_last_assistant_text', data: { text: 'answer' } },
    { command: 'set_session_name' },
    { command: 'handoff', data: { savedPath: '/home/user/handoff.md' } },
    {
        command: 'get_messages',
        data: { messages: [{ role: 'user', content: [] }] },
        expected: { messages: [{ role: 'user', raw: { role: 'user', content: [] } }] }
    },
    {
        command: 'get_login_providers',
        data: {
            providers: [{
                id: 'github',
                name: 'GitHub',
                available: true,
                authenticated: false
            }]
        }
    },
    { command: 'login', data: { providerId: 'github' } }
];

describe('OMP RPC protocol schemas', () => {
    it.each(RESPONSE_CASES)('decodes the $command response for consumers', (entry) => {
        expect(parseOmpResponseData(entry.command, entry.data)).toEqual(
            'expected' in entry ? entry.expected : entry.data
        );
    });

    it('distinguishes an omitted prompt result from a native non-invocation result', () => {
        expect(parseOmpResponseData('prompt', undefined)).toBeUndefined();
        expect(parseOmpResponseData('prompt', { agentInvoked: false })).toEqual({ agentInvoked: false });
        expect(() => parseOmpResponseData('prompt', {})).toThrow();
    });

    it('preserves nullable native cycle and handoff outcomes', () => {
        expect(parseOmpResponseData('cycle_model', null)).toBeNull();
        expect(parseOmpResponseData('cycle_thinking_level', null)).toBeNull();
        expect(parseOmpResponseData('handoff', null)).toBeNull();
    });

    it('rejects missing state, invalid model capabilities, and messages without a string role', () => {
        expect(() => parseOmpResponseData('get_state', undefined)).toThrow();
        expect(() => parseOmpResponseData('get_available_models', {
            models: [{ ...MODEL, thinking: { ...MODEL.thinking, efforts: ['unsupported'] } }]
        })).toThrow();
        expect(() => parseOmpResponseData('get_messages', {
            messages: [{ role: 42, content: [] }]
        })).toThrow();
    });

    it('separates exhaustive known events from unknown raw diagnostic frames', () => {
        expect(parseOmpInboundLine('{"type":"message_end","futureField":true}')).toEqual({
            kind: 'event',
            event: {
                kind: 'known',
                type: 'message_end',
                raw: { type: 'message_end', futureField: true }
            }
        });
        expect(parseOmpInboundLine('{"type":"future_event","value":42}')).toEqual({
            kind: 'event',
            event: {
                kind: 'unknown',
                type: 'future_event',
                raw: { type: 'future_event', value: 42 }
            }
        });
    });

    it('rejects malformed JSON and malformed response envelopes', () => {
        expect(() => parseOmpInboundLine('not-json')).toThrow('malformed JSON');
        expect(() => parseOmpInboundLine('{"type":"response","success":true}')).toThrow();
    });
});
