import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentState } from '@/api/types';
import { clearGeneratedFiles, getGeneratedFile } from '@/modules/common/generatedFiles';
import { clearGeneratedImages, getGeneratedImage } from '@/modules/common/generatedImages';
import type { OmpRpcClient } from '@/omp/rpc/OmpRpcClient';
import type {
    JsonObject,
    OmpCommand,
    OmpOutboundControlFrame
} from '@/omp/rpc/types';
import {
    OmpExtensionUiBridge,
    OmpHostToolBridge,
    OmpHostUriBridge,
    type OmpHostUriProvider
} from '../../../fork-features/omp-host-integration/cli';
import { detectOmpMachineAvailability } from '../../../fork-features/omp-host-integration/machine';

type FakeClient = {
    client: OmpRpcClient;
    requests: OmpCommand[];
    frames: OmpOutboundControlFrame[];
    request: ReturnType<typeof vi.fn>;
    sendControlFrame: ReturnType<typeof vi.fn>;
};

function createFakeClient(options?: {
    request?: (command: OmpCommand) => Promise<unknown>;
    sendControlFrame?: (frame: OmpOutboundControlFrame) => Promise<void>;
}): FakeClient {
    const requests: OmpCommand[] = [];
    const frames: OmpOutboundControlFrame[] = [];
    const request = vi.fn(async (command: OmpCommand) => {
        requests.push(command);
        if (options?.request) return await options.request(command);
        switch (command.type) {
            case 'set_host_tools':
                return { toolNames: command.tools.map((tool) => tool.name) };
            case 'set_host_uri_schemes':
                return { schemes: command.schemes.map((scheme) => scheme.scheme.toLowerCase()) };
            case 'get_login_providers':
                return { providers: [] };
            default:
                throw new Error(`Unexpected fake OMP command: ${command.type}`);
        }
    });
    const sendControlFrame = vi.fn(async (frame: OmpOutboundControlFrame) => {
        frames.push(frame);
        await options?.sendControlFrame?.(frame);
    });
    return {
        client: { request, sendControlFrame } as unknown as OmpRpcClient,
        requests,
        frames,
        request,
        sendControlFrame
    };
}

function createExtensionBridge(client: OmpRpcClient) {
    let state: AgentState = { requests: {}, completedRequests: {} };
    const messages: unknown[] = [];
    const summaries: string[] = [];
    const onFatal = vi.fn();
    const bridge = new OmpExtensionUiBridge({
        client,
        updateAgentState: (handler) => {
            state = handler(state);
        },
        sendAgentMessage: (message) => messages.push(message),
        sendSummary: (title) => summaries.push(title),
        onFatal
    });
    return { bridge, messages, summaries, onFatal, getState: () => state };
}

describe('OMP host tool bridge', () => {
    let sourceDir: string;

    beforeEach(async () => {
        sourceDir = await mkdtemp(join(tmpdir(), 'hapi-omp-host-'));
    });

    afterEach(async () => {
        clearGeneratedFiles();
        clearGeneratedImages();
        await rm(sourceDir, { recursive: true, force: true });
    });

    it('registers native tools, streams first, snapshots media/files, and rejects a missing file', async () => {
        const fake = createFakeClient();
        const messages: Array<Record<string, unknown>> = [];
        const onFatal = vi.fn();
        const bridge = new OmpHostToolBridge({
            client: fake.client,
            cwd: sourceDir,
            sendAgentMessage: (message) => messages.push(message as Record<string, unknown>),
            sendSummary: vi.fn(),
            onFatal
        });
        await bridge.register();

        const tools = fake.requests.find((request) => request.type === 'set_host_tools');
        expect(tools).toMatchObject({
            type: 'set_host_tools',
            tools: expect.arrayContaining([
                expect.objectContaining({ name: 'change_title' }),
                expect.objectContaining({ name: 'display_image' }),
                expect.objectContaining({ name: 'display_video' }),
                expect.objectContaining({ name: 'send_file' }),
                expect.objectContaining({ name: 'skill_lookup' })
            ])
        });

        const imagePath = join(sourceDir, 'actual.png');
        const videoPath = join(sourceDir, 'actual.webm');
        const filePath = join(sourceDir, 'report.pdf');
        const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
        const videoBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]);
        const fileBytes = Buffer.from('real text bytes');
        await Promise.all([
            writeFile(imagePath, imageBytes),
            writeFile(videoPath, videoBytes),
            writeFile(filePath, fileBytes)
        ]);

        const calls: JsonObject[] = [
            { type: 'host_tool_call', id: 'image-call', toolCallId: 'tool-1', toolName: 'display_image', arguments: { path: imagePath } },
            { type: 'host_tool_call', id: 'video-call', toolCallId: 'tool-2', toolName: 'display_video', arguments: { path: videoPath } },
            { type: 'host_tool_call', id: 'file-call', toolCallId: 'tool-3', toolName: 'send_file', arguments: { path: filePath } },
            { type: 'host_tool_call', id: 'missing-call', toolCallId: 'tool-4', toolName: 'send_file', arguments: { path: join(sourceDir, 'missing.bin') } }
        ];
        for (const call of calls) bridge.handleCall(call);

        await vi.waitFor(() => {
            expect(fake.frames.filter((frame) => frame.type === 'host_tool_result')).toHaveLength(4);
        });
        for (const id of ['image-call', 'video-call', 'file-call', 'missing-call']) {
            const updateIndex = fake.frames.findIndex((frame) => frame.type === 'host_tool_update' && frame.id === id);
            const resultIndex = fake.frames.findIndex((frame) => frame.type === 'host_tool_result' && frame.id === id);
            expect(updateIndex).toBeGreaterThanOrEqual(0);
            expect(resultIndex).toBeGreaterThan(updateIndex);
        }

        const imageMessage = messages.find((message) => message.fileName === 'actual.png');
        const videoMessage = messages.find((message) => message.fileName === 'actual.webm');
        const fileMessage = messages.find((message) => message.type === 'generated-file');
        expect(imageMessage?.mimeType).toBe('image/png');
        expect(videoMessage?.mimeType).toBe('video/webm');
        expect(fileMessage?.mimeType).toBe('text/plain');
        expect(imageMessage).toMatchObject({ id: 'tool-1', toolCallId: 'tool-1' });
        expect(videoMessage).toMatchObject({ id: 'tool-2', toolCallId: 'tool-2' });
        expect(fileMessage).toMatchObject({ id: 'tool-3', toolCallId: 'tool-3' });

        const image = getGeneratedImage(String(imageMessage?.imageId));
        const video = getGeneratedImage(String(videoMessage?.imageId));
        const file = getGeneratedFile(String(fileMessage?.fileId));
        expect(image?.content).toEqual(imageBytes);
        expect(video?.content).toEqual(videoBytes);
        expect(file).not.toBeNull();
        await expect(readFile(file!.snapshotPath)).resolves.toEqual(fileBytes);

        const missingResult = fake.frames.find((frame) => frame.type === 'host_tool_result' && frame.id === 'missing-call');
        expect(missingResult).toMatchObject({ type: 'host_tool_result', id: 'missing-call', isError: true });
        expect(onFatal).not.toHaveBeenCalled();
        bridge.close();
    });

    it('treats an inbound cancel as the only terminal outcome', async () => {
        const updateGate = Promise.withResolvers<void>();
        const fake = createFakeClient({
            sendControlFrame: async (frame) => {
                if (frame.type === 'host_tool_update') await updateGate.promise;
            }
        });
        const sendAgentMessage = vi.fn();
        const bridge = new OmpHostToolBridge({
            client: fake.client,
            cwd: sourceDir,
            sendAgentMessage,
            sendSummary: vi.fn(),
            onFatal: vi.fn()
        });
        await bridge.register();
        const imagePath = join(sourceDir, 'cancel.png');
        await writeFile(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

        bridge.handleCall({
            type: 'host_tool_call', id: 'cancelled-call', toolCallId: 'tool-cancel', toolName: 'display_image', arguments: { path: imagePath }
        });
        await vi.waitFor(() => expect(fake.frames).toHaveLength(1));
        bridge.handleCancel({ type: 'host_tool_cancel', id: 'cancel-frame', targetId: 'cancelled-call' });
        updateGate.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(fake.frames).toEqual([
            expect.objectContaining({ type: 'host_tool_update', id: 'cancelled-call' })
        ]);
        expect(sendAgentMessage).not.toHaveBeenCalled();
        bridge.close();
    });

    it('discards a generated artifact when cancel arrives during the terminal result write', async () => {
        const resultGate = Promise.withResolvers<void>();
        const fake = createFakeClient({
            sendControlFrame: async (frame) => {
                if (frame.type === 'host_tool_result') await resultGate.promise;
            }
        });
        const sendAgentMessage = vi.fn();
        const onFatal = vi.fn();
        const bridge = new OmpHostToolBridge({
            client: fake.client,
            cwd: sourceDir,
            sendAgentMessage,
            sendSummary: vi.fn(),
            onFatal
        });
        await bridge.register();
        const imagePath = join(sourceDir, 'cancel-during-result.png');
        await writeFile(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

        bridge.handleCall({
            type: 'host_tool_call',
            id: 'cancel-during-result',
            toolCallId: 'tool-cancel-during-result',
            toolName: 'display_image',
            arguments: { path: imagePath }
        });
        await vi.waitFor(() => expect(fake.frames.some(
            (frame) => frame.type === 'host_tool_result' && frame.id === 'cancel-during-result'
        )).toBe(true));
        const terminalFrame = fake.frames.find(
            (frame) => frame.type === 'host_tool_result' && frame.id === 'cancel-during-result'
        );
        if (terminalFrame?.type !== 'host_tool_result') {
            throw new Error('Expected terminal host tool result frame');
        }
        const imageId = terminalFrame.result.details?.imageId;
        expect(typeof imageId).toBe('string');
        expect(getGeneratedImage(String(imageId))).not.toBeNull();

        bridge.handleCancel({
            type: 'host_tool_cancel',
            id: 'cancel-frame',
            targetId: 'cancel-during-result'
        });
        await vi.waitFor(() => expect(getGeneratedImage(String(imageId))).toBeNull());
        resultGate.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(sendAgentMessage).not.toHaveBeenCalled();
        expect(onFatal).not.toHaveBeenCalled();
        bridge.close();
    });

    it('discards registered media and file snapshots when the terminal frame write fails', async () => {
        const fake = createFakeClient({
            sendControlFrame: async (frame) => {
                if (frame.type === 'host_tool_result') throw new Error('terminal frame write failed');
            }
        });
        const sendAgentMessage = vi.fn();
        const onFatal = vi.fn();
        const bridge = new OmpHostToolBridge({
            client: fake.client,
            cwd: sourceDir,
            sendAgentMessage,
            sendSummary: vi.fn(),
            onFatal
        });
        await bridge.register();
        const imagePath = join(sourceDir, 'discard.png');
        const filePath = join(sourceDir, 'discard.txt');
        await writeFile(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
        await writeFile(filePath, 'discarded file');

        bridge.handleCall({
            type: 'host_tool_call', id: 'image-write-failure', toolCallId: 'tool-image-failure', toolName: 'display_image', arguments: { path: imagePath }
        });
        bridge.handleCall({
            type: 'host_tool_call', id: 'file-write-failure', toolCallId: 'tool-file-failure', toolName: 'send_file', arguments: { path: filePath }
        });

        await vi.waitFor(() => expect(onFatal).toHaveBeenCalledTimes(2));
        const imageFrame = fake.frames.find((frame) => frame.type === 'host_tool_result' && frame.id === 'image-write-failure');
        const fileFrame = fake.frames.find((frame) => frame.type === 'host_tool_result' && frame.id === 'file-write-failure');
        expect(imageFrame?.type).toBe('host_tool_result');
        expect(fileFrame?.type).toBe('host_tool_result');
        if (imageFrame?.type !== 'host_tool_result' || fileFrame?.type !== 'host_tool_result') {
            throw new Error('Expected terminal host tool result frames');
        }
        const imageId = imageFrame.result.details?.imageId;
        const fileId = fileFrame.result.details?.fileId;
        expect(typeof imageId).toBe('string');
        expect(typeof fileId).toBe('string');
        expect(getGeneratedImage(String(imageId))).toBeNull();
        expect(getGeneratedFile(String(fileId))).toBeNull();
        expect(sendAgentMessage).not.toHaveBeenCalled();
        bridge.close();
    });
});

describe('OMP host URI bridge', () => {
    it('keeps read/write/error/cancel lifecycle in its own typed bridge', async () => {
        const fake = createFakeClient();
        const cancelledRead = Promise.withResolvers<{ content: string }>();
        const writes: Array<{ url: string; content: string }> = [];
        const provider: OmpHostUriProvider = {
            definition: { scheme: 'hapi', writable: true, immutable: true },
            read: async (url) => {
                if (url.endsWith('/cancel')) return await cancelledRead.promise;
                if (url.endsWith('/error')) throw new Error('host URI exploded');
                return { content: '# resolved', contentType: 'text/markdown', notes: ['from HAPI'] };
            },
            write: async (url, content) => {
                writes.push({ url, content });
            }
        };
        const onFatal = vi.fn();
        const bridge = new OmpHostUriBridge(fake.client, [provider], onFatal);
        await bridge.register();

        bridge.handleRequest({ type: 'host_uri_request', id: 'read', operation: 'read', url: 'hapi://docs/readme' });
        bridge.handleRequest({ type: 'host_uri_request', id: 'write', operation: 'write', url: 'hapi://docs/note', content: 'saved' });
        bridge.handleRequest({ type: 'host_uri_request', id: 'error', operation: 'read', url: 'hapi://docs/error' });
        bridge.handleRequest({ type: 'host_uri_request', id: 'cancel', operation: 'read', url: 'hapi://docs/cancel' });

        await vi.waitFor(() => {
            expect(fake.frames.filter((frame) => frame.type === 'host_uri_result')).toHaveLength(3);
        });
        expect(fake.frames).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'host_uri_result', id: 'read', content: '# resolved', contentType: 'text/markdown' }),
            expect.objectContaining({ type: 'host_uri_result', id: 'write' }),
            expect.objectContaining({ type: 'host_uri_result', id: 'error', isError: true, error: 'host URI exploded' })
        ]));
        expect(writes).toEqual([{ url: 'hapi://docs/note', content: 'saved' }]);

        bridge.handleCancel({ type: 'host_uri_cancel', id: 'cancel-frame', targetId: 'cancel' });
        cancelledRead.resolve({ content: 'too late' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(fake.frames.some((frame) => frame.type === 'host_uri_result' && frame.id === 'cancel')).toBe(false);
        expect(onFatal).not.toHaveBeenCalled();
        bridge.close();
    });

    it('reports a failed timeout result write through the fatal transport path', async () => {
        vi.useFakeTimers();
        try {
            const fake = createFakeClient({
                sendControlFrame: async (frame) => {
                    if (frame.type === 'host_uri_result') throw new Error('host URI result write failed');
                }
            });
            const provider: OmpHostUriProvider = {
                definition: { scheme: 'hapi' },
                read: async (_url, signal) => await new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
                })
            };
            const onFatal = vi.fn();
            const bridge = new OmpHostUriBridge(fake.client, [provider], onFatal);
            await bridge.register();
            bridge.handleRequest({
                type: 'host_uri_request', id: 'timeout-write-failure', operation: 'read', url: 'hapi://docs/slow'
            });

            await vi.advanceTimersByTimeAsync(120_000);

            expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({
                message: 'host URI result write failed'
            }));
            bridge.close();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('OMP extension UI bridge', () => {
    it('returns the four waited response shapes by request id', async () => {
        const fake = createFakeClient();
        const harness = createExtensionBridge(fake.client);
        const requests: JsonObject[] = [
            { type: 'extension_ui_request', id: 'select', method: 'select', title: 'Pick one', options: ['A', 'B'] },
            { type: 'extension_ui_request', id: 'confirm', method: 'confirm', title: 'Continue?', message: 'Confirm action' },
            { type: 'extension_ui_request', id: 'input', method: 'input', title: 'Code', placeholder: 'Paste code' },
            { type: 'extension_ui_request', id: 'editor', method: 'editor', title: 'Edit', prefill: 'initial' }
        ];
        for (const request of requests) harness.bridge.handle(request);

        expect(Object.keys(harness.getState().requests ?? {})).toEqual(['select', 'confirm', 'input', 'editor']);
        expect(harness.getState().requests?.input.arguments).toMatchObject({
            questions: [expect.objectContaining({ placeholder: 'Paste code', required: false })]
        });
        expect(harness.getState().requests?.editor.arguments).toMatchObject({
            questions: [expect.objectContaining({ initialValue: 'initial', multiline: true, required: false })]
        });

        await harness.bridge.handleWebResponse({ id: 'select', approved: true, answers: { value: { answers: ['B'] } } });
        await harness.bridge.handleWebResponse({ id: 'confirm', approved: true, answers: { confirmed: { answers: ['No'] } } });
        await harness.bridge.handleWebResponse({ id: 'input', approved: true, answers: { value: { answers: ['user_note: oauth-code'] } } });
        await harness.bridge.handleWebResponse({ id: 'editor', approved: true, answers: { value: { answers: [] } } });

        expect(fake.frames).toEqual([
            { type: 'extension_ui_response', id: 'select', value: 'B' },
            { type: 'extension_ui_response', id: 'confirm', confirmed: false },
            { type: 'extension_ui_response', id: 'input', value: 'oauth-code' },
            { type: 'extension_ui_response', id: 'editor', value: '' }
        ]);
        expect(harness.getState().requests).toEqual({});
        expect(Object.keys(harness.getState().completedRequests ?? {})).toEqual(['select', 'confirm', 'input', 'editor']);
        expect(harness.onFatal).not.toHaveBeenCalled();
    });

    it('owns timeout and OMP cancellation cleanup without leaving pending requests', async () => {
        vi.useFakeTimers();
        try {
            const fake = createFakeClient();
            const harness = createExtensionBridge(fake.client);
            harness.bridge.handle({
                type: 'extension_ui_request', id: 'timeout', method: 'input', title: 'Timed', timeout: 25
            });
            harness.bridge.handle({
                type: 'extension_ui_request', id: 'cancelled', method: 'editor', title: 'Cancelled'
            });
            harness.bridge.handle({
                type: 'extension_ui_request', id: 'cancel-frame', method: 'cancel', targetId: 'cancelled'
            });

            await vi.advanceTimersByTimeAsync(25);
            expect(fake.frames).toEqual([
                { type: 'extension_ui_response', id: 'timeout', cancelled: true, timedOut: true }
            ]);
            expect(harness.getState().requests).toEqual({});
            expect(harness.getState().completedRequests?.cancelled.reason).toBe('Cancelled by OMP');
            expect(harness.getState().completedRequests?.timeout.reason).toBe('Timed out');
        } finally {
            vi.useRealTimers();
        }
    });

    it('accepts an immediate zero-millisecond timeout', async () => {
        vi.useFakeTimers();
        try {
            const fake = createFakeClient();
            const harness = createExtensionBridge(fake.client);
            harness.bridge.handle({
                type: 'extension_ui_request', id: 'immediate-timeout', method: 'input', title: 'Immediate', timeout: 0
            });

            await vi.advanceTimersByTimeAsync(0);

            expect(fake.frames).toContainEqual({
                type: 'extension_ui_response', id: 'immediate-timeout', cancelled: true, timedOut: true
            });
            expect(harness.getState().requests).toEqual({});
            expect(harness.onFatal).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('settles a timed-out request before writing its only response frame', async () => {
        const writeGate = Promise.withResolvers<void>();
        const fake = createFakeClient({
            sendControlFrame: async () => await writeGate.promise
        });
        const harness = createExtensionBridge(fake.client);
        harness.bridge.handle({
            type: 'extension_ui_request', id: 'race', method: 'input', title: 'Timed', timeout: 1
        });

        await vi.waitFor(() => expect(fake.frames).toHaveLength(1));
        expect(harness.getState().requests).toEqual({});
        await expect(harness.bridge.handleWebResponse({
            id: 'race', approved: true, answers: { value: { answers: ['too-late'] } }
        })).rejects.toThrow('no longer pending');

        writeGate.resolve();
        await vi.waitFor(() => {
            expect(fake.frames).toEqual([
                { type: 'extension_ui_response', id: 'race', cancelled: true, timedOut: true }
            ]);
        });
    });

    it('presents all seven fire-and-forget methods without waiting for an OMP response', async () => {
        const fake = createFakeClient();
        const harness = createExtensionBridge(fake.client);
        harness.bridge.handle({ type: 'extension_ui_request', id: 'waited', method: 'input', title: 'Cancel me' });
        harness.bridge.handle({ type: 'extension_ui_request', id: 'cancel', method: 'cancel', targetId: 'waited' });
        harness.bridge.handle({ type: 'extension_ui_request', id: 'notify', method: 'notify', message: 'Hello', notifyType: 'warning' });
        harness.bridge.handle({ type: 'extension_ui_request', id: 'status', method: 'setStatus', statusKey: 'build', statusText: 'running' });
        harness.bridge.handle({ type: 'extension_ui_request', id: 'widget', method: 'setWidget', widgetKey: 'checks', widgetLines: ['one'] });
        harness.bridge.handle({ type: 'extension_ui_request', id: 'title', method: 'setTitle', title: 'Native title' });
        harness.bridge.handle({ type: 'extension_ui_request', id: 'editor-text', method: 'set_editor_text', text: 'draft' });
        harness.bridge.handle({
            type: 'extension_ui_request', id: 'url', method: 'open_url', url: 'https://provider.example/oauth', launchUrl: 'http://127.0.0.1:4567/launch'
        });

        expect(fake.frames).toEqual([]);
        expect(harness.summaries).toEqual(['Native title']);
        expect(harness.messages).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'omp-extension-ui', method: 'notify', level: 'warning' }),
            expect.objectContaining({ type: 'omp-extension-ui', method: 'setStatus', key: 'build' }),
            expect.objectContaining({ type: 'omp-extension-ui', method: 'setWidget', key: 'checks' }),
            expect.objectContaining({ type: 'omp-extension-ui', method: 'setTitle', title: 'Native title' }),
            expect.objectContaining({ type: 'omp-extension-ui', method: 'set_editor_text', text: 'draft' }),
            expect.objectContaining({ type: 'omp-extension-ui', method: 'open_url', url: 'https://provider.example/oauth' })
        ]));
        expect(harness.getState().requests?.url.arguments).toMatchObject({
            url: 'http://127.0.0.1:4567/launch',
            questions: [expect.objectContaining({ id: '__mcp_url_confirmation' })]
        });
        await harness.bridge.close('test complete');
        expect(harness.getState().requests).toEqual({});
    });
    it('strips ANSI escape codes from extension presentation text before it reaches the hub', async () => {
        const fake = createFakeClient();
        const harness = createExtensionBridge(fake.client);
        harness.bridge.handle({
            type: 'extension_ui_request', id: 'status', method: 'setStatus', statusKey: 'rewind',
            statusText: '\u001b[38;5;243m◆ \u001b[39m\u001b[38;5;248m4 checkpoints\u001b[39m'
        });
        harness.bridge.handle({
            type: 'extension_ui_request', id: 'notify', method: 'notify', message: '\u001b[31mDeploy failed\u001b[0m', notifyType: 'error'
        });
        harness.bridge.handle({
            type: 'extension_ui_request', id: 'widget', method: 'setWidget', widgetKey: 'build',
            widgetLines: ['\u001b[32m✓\u001b[39m tests passed']
        });
        harness.bridge.handle({
            type: 'extension_ui_request', id: 'title', method: 'setTitle', title: '\u001b[1mBold title\u001b[0m'
        });

        expect(harness.messages).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'omp-extension-ui', method: 'notify', message: 'Deploy failed', level: 'error' }),
            expect.objectContaining({ type: 'omp-extension-ui', method: 'setStatus', key: 'rewind', text: '◆ 4 checkpoints' }),
            expect.objectContaining({ type: 'omp-extension-ui', method: 'setWidget', key: 'build', lines: ['✓ tests passed'] }),
            expect.objectContaining({ type: 'omp-extension-ui', method: 'setTitle', title: 'Bold title' })
        ]));
        expect(harness.summaries).toEqual(['Bold title']);
        // No raw escape may leak into anything the bridge emits to the hub.
        expect(JSON.stringify(harness.messages)).not.toContain('\u001b');
        expect(JSON.stringify(harness.summaries)).not.toContain('\u001b');
        await harness.bridge.close('test complete');
    });
});

describe('OMP runner capability detection', () => {
    it('advertises only supported OMP installations', async () => {
        const supported = await detectOmpMachineAvailability(async () => ({
            raw: 'omp/17.1.7',
            major: 17,
            minor: 1,
            patch: 7
        }));
        const outdated = await detectOmpMachineAvailability(async () => ({
            raw: 'omp/16.9.0',
            major: 16,
            minor: 9,
            patch: 0
        }));
        const missing = await detectOmpMachineAvailability(async () => {
            throw new Error('omp was not found on PATH');
        });

        expect(supported).toMatchObject({ available: true, version: { raw: 'omp/17.1.7' } });
        expect(outdated).toEqual({
            available: false,
            error: 'OMP 16.9.0 is too old; HAPI requires OMP 17.0.4 or newer for RPC mode'
        });
        expect(missing).toEqual({ available: false, error: 'omp was not found on PATH' });
    });
});
