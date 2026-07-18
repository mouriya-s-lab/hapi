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

const RESPONSE_CASES: ReadonlyArray<{
    command: OmpCommandType;
    data?: JsonValue;
}> = [
    { command: 'prompt', data: { agentInvoked: true } },
    { command: 'steer' },
    { command: 'follow_up' },
    { command: 'abort' },
    { command: 'abort_and_prompt' },
    { command: 'new_session', data: { cancelled: false } },
    { command: 'get_state', data: STATE },
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
        }
    },
    { command: 'set_model', data: MODEL },
    { command: 'cycle_model', data: { model: MODEL, thinkingLevel: 'inherit', isScoped: false } },
    { command: 'get_available_models', data: { models: [MODEL] } },
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
    { command: 'get_messages', data: { messages: [{ role: 'user', content: [] }] } },
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
    it('parses the success payload for every one of the 39 commands', () => {
        expect(RESPONSE_CASES).toHaveLength(39);
        expect(new Set(RESPONSE_CASES.map((entry) => entry.command)).size).toBe(39);

        for (const entry of RESPONSE_CASES) {
            expect(() => parseOmpResponseData(entry.command, entry.data)).not.toThrow();
        }
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
