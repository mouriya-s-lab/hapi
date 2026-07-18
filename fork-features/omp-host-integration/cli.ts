import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentState } from '../../cli/src/api/types';
import type { ApiSessionClient } from '../../cli/src/api/apiSession';
import type { RawJSONLines } from '../../cli/src/claude/types';
import { registerGeneratedFile } from '../../cli/src/modules/common/generatedFiles';
import { registerGeneratedMediaFromPath } from '../../cli/src/modules/common/generatedImages';
import { resolveSkill } from '../../cli/src/modules/common/skills';
import type { OmpRpcClient } from '../../cli/src/omp/rpc/OmpRpcClient';
import type {
    JsonObject,
    OmpAgentToolResult,
    OmpExtensionUiRequest,
    OmpHostIntegrationEvent,
    OmpHostToolCallRequest,
    OmpHostToolDefinition,
    OmpHostUriRequest,
    OmpHostUriSchemeDefinition,
    OmpLoginProvider,
    OmpOutboundControlFrame
} from '../../cli/src/omp/rpc/types';
import { logger } from '../../cli/src/ui/logger';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';
import type {
    OmpLoginProvidersResponse,
    StartOmpLoginRequest,
    StartOmpLoginResponse
} from '@hapi/protocol/apiTypes';

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
]));
const JsonObjectSchema = z.record(z.string(), JsonValueSchema) as z.ZodType<JsonObject>;

const ExtensionUiRequestSchema = z.discriminatedUnion('method', [
    z.object({ type: z.literal('extension_ui_request'), id: z.string(), method: z.literal('select'), title: z.string(), options: z.array(z.string()), timeout: z.number().positive().optional() }),
    z.object({ type: z.literal('extension_ui_request'), id: z.string(), method: z.literal('confirm'), title: z.string(), message: z.string(), timeout: z.number().positive().optional() }),
    z.object({ type: z.literal('extension_ui_request'), id: z.string(), method: z.literal('input'), title: z.string(), placeholder: z.string().optional(), timeout: z.number().positive().optional() }),
    z.object({ type: z.literal('extension_ui_request'), id: z.string(), method: z.literal('editor'), title: z.string(), prefill: z.string().optional(), promptStyle: z.boolean().optional() }),
    z.object({ type: z.literal('extension_ui_request'), id: z.string(), method: z.literal('cancel'), targetId: z.string() }),
    z.object({ type: z.literal('extension_ui_request'), id: z.string(), method: z.literal('notify'), message: z.string(), notifyType: z.enum(['info', 'warning', 'error']).optional() }),
    z.object({ type: z.literal('extension_ui_request'), id: z.string(), method: z.literal('setStatus'), statusKey: z.string(), statusText: z.string().optional() }),
    z.object({ type: z.literal('extension_ui_request'), id: z.string(), method: z.literal('setWidget'), widgetKey: z.string(), widgetLines: z.array(z.string()).optional(), widgetPlacement: z.enum(['aboveEditor', 'belowEditor']).optional() }),
    z.object({ type: z.literal('extension_ui_request'), id: z.string(), method: z.literal('setTitle'), title: z.string() }),
    z.object({ type: z.literal('extension_ui_request'), id: z.string(), method: z.literal('set_editor_text'), text: z.string() }),
    z.object({ type: z.literal('extension_ui_request'), id: z.string(), method: z.literal('open_url'), url: z.string(), launchUrl: z.string().optional(), instructions: z.string().optional() })
]);

const HostToolCallSchema = z.object({
    type: z.literal('host_tool_call'),
    id: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    arguments: JsonObjectSchema
});

const HostToolCancelSchema = z.object({
    type: z.literal('host_tool_cancel'),
    id: z.string(),
    targetId: z.string()
});

const HostUriRequestSchema = z.object({
    type: z.literal('host_uri_request'),
    id: z.string(),
    operation: z.enum(['read', 'write']),
    url: z.string(),
    content: z.string().optional()
});

const HostUriCancelSchema = z.object({
    type: z.literal('host_uri_cancel'),
    id: z.string(),
    targetId: z.string()
});

const PermissionResponseSchema = z.object({
    id: z.string(),
    approved: z.boolean(),
    decision: z.enum(['approved', 'approved_for_session', 'denied', 'abort']).optional(),
    answers: z.union([
        z.record(z.string(), z.array(z.string())),
        z.record(z.string(), z.object({ answers: z.array(z.string()) }))
    ]).optional()
});

const StartLoginRequestSchema = z.object({ providerId: z.string().min(1) });
const MediaToolArgsSchema = z.object({ path: z.string().min(1), title: z.string().optional() });
const ChangeTitleArgsSchema = z.object({ title: z.string().trim().min(1).max(255) });
const SkillLookupArgsSchema = z.object({ name: z.string().trim().min(1).max(128) });

const HOST_OPERATION_TIMEOUT_MS = 120_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;

function textResult(text: string, details: JsonObject = {}): OmpAgentToolResult {
    return { content: [{ type: 'text', text }], details };
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function abortError(operation: string): Error {
    const error = new Error(`${operation} was cancelled`);
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal: AbortSignal, operation: string): void {
    if (signal.aborted) throw abortError(operation);
}

const HOST_TOOL_DEFINITIONS: OmpHostToolDefinition[] = [
    {
        name: 'change_title',
        label: 'Change Chat Title',
        description: 'Change the title of the current HAPI chat session. Use a concise title when the primary objective becomes clear.',
        parameters: {
            type: 'object',
            properties: { title: { type: 'string', description: 'Concise chat title' } },
            required: ['title'],
            additionalProperties: false
        },
        loadMode: 'discoverable'
    },
    {
        name: 'display_image',
        label: 'Display Image',
        description: 'Snapshot a local image file and display its real bytes inline in the current HAPI chat.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Absolute local filesystem path' },
                title: { type: 'string', description: 'Optional display filename' }
            },
            required: ['path'],
            additionalProperties: false
        },
        loadMode: 'discoverable'
    },
    {
        name: 'display_video',
        label: 'Display Video',
        description: 'Snapshot a local mp4 or webm file and display its real bytes inline in the current HAPI chat.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Absolute local filesystem path' },
                title: { type: 'string', description: 'Optional display filename' }
            },
            required: ['path'],
            additionalProperties: false
        },
        loadMode: 'discoverable'
    },
    {
        name: 'send_file',
        label: 'Send File',
        description: 'Snapshot a local regular file and send the snapshot to the current HAPI chat for download.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Absolute local filesystem path' },
                title: { type: 'string', description: 'Optional display filename' }
            },
            required: ['path'],
            additionalProperties: false
        },
        loadMode: 'discoverable'
    },
    {
        name: 'skill_lookup',
        label: 'Look Up Skill',
        description: 'Load a HAPI skill by its exact discovered name before following that skill.',
        parameters: {
            type: 'object',
            properties: { name: { type: 'string', description: 'Exact HAPI skill name' } },
            required: ['name'],
            additionalProperties: false
        },
        loadMode: 'deferred'
    }
];

type PendingHostTool = {
    request: OmpHostToolCallRequest;
    controller: AbortController;
    timer: ReturnType<typeof setTimeout>;
    cancelled: boolean;
    timedOut: boolean;
};

type HostToolExecution = {
    result: OmpAgentToolResult;
    publish?: () => void;
};

export type OmpExtensionUiPresentationEvent =
    | { type: 'omp-extension-ui'; method: 'notify'; message: string; level: 'info' | 'warning' | 'error' }
    | { type: 'omp-extension-ui'; method: 'setStatus'; key: string; text: string | null }
    | { type: 'omp-extension-ui'; method: 'setWidget'; key: string; lines: string[]; placement?: 'aboveEditor' | 'belowEditor' }
    | { type: 'omp-extension-ui'; method: 'setTitle'; title: string }
    | { type: 'omp-extension-ui'; method: 'set_editor_text'; text: string }
    | { type: 'omp-extension-ui'; method: 'open_url'; url: string; instructions?: string }
    | { type: 'omp-extension-ui'; method: 'login_status'; providerId: string; status: 'started' | 'authenticated' | 'failed'; message: string };

type OmpHostToolBridgeOptions = {
    client: OmpRpcClient;
    cwd: string;
    sendAgentMessage: (message: unknown) => void;
    sendSummary: (title: string) => void;
    onFatal: (error: Error) => void;
};

export class OmpHostToolBridge {
    private readonly pending = new Map<string, PendingHostTool>();
    private readonly tasks = new Set<Promise<void>>();

    constructor(private readonly options: OmpHostToolBridgeOptions) {}

    async register(): Promise<void> {
        const result = await this.options.client.request({
            type: 'set_host_tools',
            tools: HOST_TOOL_DEFINITIONS
        });
        const expected = HOST_TOOL_DEFINITIONS.map((tool) => tool.name);
        if (JSON.stringify(result.toolNames) !== JSON.stringify(expected)) {
            throw new Error(`OMP registered unexpected host tools: ${result.toolNames.join(', ')}`);
        }
    }

    handleCall(raw: JsonObject): void {
        const parsed = HostToolCallSchema.safeParse(raw);
        if (!parsed.success) {
            this.options.onFatal(new Error(`Invalid OMP host_tool_call: ${parsed.error.message}`));
            return;
        }
        const request = parsed.data;
        if (this.pending.has(request.id)) {
            this.options.onFatal(new Error(`Duplicate OMP host tool call id: ${request.id}`));
            return;
        }

        const controller = new AbortController();
        const pending: PendingHostTool = {
            request,
            controller,
            cancelled: false,
            timedOut: false,
            timer: setTimeout(() => {
                pending.timedOut = true;
                controller.abort();
                this.track(this.finishError(pending, new Error(
                    `HAPI host tool ${request.toolName} timed out after ${HOST_OPERATION_TIMEOUT_MS}ms`
                )));
            }, HOST_OPERATION_TIMEOUT_MS)
        };
        pending.timer.unref();
        this.pending.set(request.id, pending);
        this.track(this.execute(pending));
    }

    handleCancel(raw: JsonObject): void {
        const parsed = HostToolCancelSchema.safeParse(raw);
        if (!parsed.success) {
            this.options.onFatal(new Error(`Invalid OMP host_tool_cancel: ${parsed.error.message}`));
            return;
        }
        const pending = this.pending.get(parsed.data.targetId);
        if (!pending) {
            logger.debug(`[omp-host] cancel ignored for settled tool call ${parsed.data.targetId}`);
            return;
        }
        pending.cancelled = true;
        clearTimeout(pending.timer);
        this.pending.delete(parsed.data.targetId);
        pending.controller.abort();
    }

    close(): void {
        for (const pending of this.pending.values()) {
            pending.cancelled = true;
            clearTimeout(pending.timer);
            pending.controller.abort();
        }
        this.pending.clear();
    }

    private async execute(pending: PendingHostTool): Promise<void> {
        try {
            await this.options.client.sendControlFrame({
                type: 'host_tool_update',
                id: pending.request.id,
                partialResult: textResult(`HAPI is running ${pending.request.toolName}`)
            });
            const execution = await this.executeTool(pending.request, pending.controller.signal);
            await this.finishSuccess(pending, execution);
        } catch (error) {
            if (pending.cancelled || pending.timedOut) return;
            await this.finishError(pending, error);
        }
    }

    private async executeTool(
        request: OmpHostToolCallRequest,
        signal: AbortSignal
    ): Promise<HostToolExecution> {
        switch (request.toolName) {
            case 'change_title': {
                const args = ChangeTitleArgsSchema.parse(request.arguments);
                throwIfAborted(signal, request.toolName);
                return {
                    result: textResult(`Changed HAPI chat title to: ${args.title}`),
                    publish: () => this.options.sendSummary(args.title)
                };
            }
            case 'display_image':
                return await this.displayMedia(request, signal, 'image');
            case 'display_video':
                return await this.displayMedia(request, signal, 'video');
            case 'send_file': {
                const args = MediaToolArgsSchema.parse(request.arguments);
                throwIfAborted(signal, request.toolName);
                const file = await registerGeneratedFile({
                    id: randomUUID(),
                    path: args.path,
                    fileName: args.title
                });
                throwIfAborted(signal, request.toolName);
                return {
                    result: textResult(`Sent file: ${file.fileName} (${file.size} bytes)`, {
                        toolCallId: request.toolCallId,
                        fileId: file.id,
                        fileName: file.fileName,
                        mimeType: file.mimeType,
                        size: file.size
                    }),
                    publish: () => this.options.sendAgentMessage({
                        type: 'generated-file',
                        fileId: file.id,
                        fileName: file.fileName,
                        mimeType: file.mimeType,
                        size: file.size,
                        id: request.toolCallId,
                        toolCallId: request.toolCallId
                    })
                };
            }
            case 'skill_lookup': {
                const args = SkillLookupArgsSchema.parse(request.arguments);
                const skill = await resolveSkill(args.name, this.options.cwd, { flavor: 'omp' });
                throwIfAborted(signal, request.toolName);
                if (!skill) throw new Error(`Skill not found: ${args.name}`);
                const header = [
                    `Skill: ${skill.name}`,
                    ...(skill.description ? [`Description: ${skill.description}`] : [])
                ].join('\n');
                return { result: textResult(`${header}\n\n${skill.body}`) };
            }
            default:
                throw new Error(`HAPI host tool is not registered: ${request.toolName}`);
        }
    }

    private async displayMedia(
        request: OmpHostToolCallRequest,
        signal: AbortSignal,
        kind: 'image' | 'video'
    ): Promise<HostToolExecution> {
        const args = MediaToolArgsSchema.parse(request.arguments);
        throwIfAborted(signal, request.toolName);
        const result = await registerGeneratedMediaFromPath({
            path: args.path,
            kind,
            fileName: args.title
        });
        if (!result.ok) throw new Error(result.error.message);
        throwIfAborted(signal, request.toolName);
        return {
            result: textResult(`Displayed ${kind}: ${result.media.fileName}`, {
                toolCallId: request.toolCallId,
                imageId: result.media.id,
                fileName: result.media.fileName,
                mimeType: result.media.mimeType
            }),
            publish: () => this.options.sendAgentMessage({
                type: 'generated-image',
                imageId: result.media.id,
                fileName: result.media.fileName,
                mimeType: result.media.mimeType,
                id: request.toolCallId,
                toolCallId: request.toolCallId
            })
        };
    }

    private async finishSuccess(pending: PendingHostTool, execution: HostToolExecution): Promise<void> {
        if (!this.takePending(pending)) return;
        execution.publish?.();
        await this.options.client.sendControlFrame({
            type: 'host_tool_result',
            id: pending.request.id,
            result: execution.result
        });
    }

    private async finishError(pending: PendingHostTool, error: unknown): Promise<void> {
        if (!this.takePending(pending)) return;
        await this.options.client.sendControlFrame({
            type: 'host_tool_result',
            id: pending.request.id,
            result: textResult(errorText(error)),
            isError: true
        });
    }

    private takePending(pending: PendingHostTool): boolean {
        if (this.pending.get(pending.request.id) !== pending || pending.cancelled) return false;
        clearTimeout(pending.timer);
        this.pending.delete(pending.request.id);
        return true;
    }

    private track(task: Promise<void>): void {
        let tracked: Promise<void>;
        tracked = task
            .catch((error) => this.options.onFatal(error instanceof Error ? error : new Error(String(error))))
            .finally(() => this.tasks.delete(tracked));
        this.tasks.add(tracked);
    }
}

export type OmpHostUriReadResult = {
    content: string;
    contentType?: 'text/markdown' | 'application/json' | 'text/plain';
    notes?: string[];
    immutable?: boolean;
};

export type OmpHostUriProvider = {
    definition: OmpHostUriSchemeDefinition;
    read: (url: string, signal: AbortSignal) => Promise<OmpHostUriReadResult>;
    write?: (url: string, content: string, signal: AbortSignal) => Promise<void>;
};

type PendingHostUri = {
    request: OmpHostUriRequest;
    controller: AbortController;
    timer: ReturnType<typeof setTimeout>;
    cancelled: boolean;
};

export class OmpHostUriBridge {
    private readonly pending = new Map<string, PendingHostUri>();
    private readonly providersByScheme: ReadonlyMap<string, OmpHostUriProvider>;

    constructor(
        private readonly client: OmpRpcClient,
        providers: OmpHostUriProvider[],
        private readonly onFatal: (error: Error) => void
    ) {
        this.providersByScheme = new Map(providers.map((provider) => [
            provider.definition.scheme.toLowerCase(),
            provider
        ]));
    }

    async register(): Promise<void> {
        const definitions = Array.from(this.providersByScheme.values()).map((provider) => provider.definition);
        const result = await this.client.request({ type: 'set_host_uri_schemes', schemes: definitions });
        const expected = definitions.map((definition) => definition.scheme.toLowerCase());
        if (JSON.stringify(result.schemes) !== JSON.stringify(expected)) {
            throw new Error(`OMP registered unexpected host URI schemes: ${result.schemes.join(', ')}`);
        }
    }

    handleRequest(raw: JsonObject): void {
        const parsed = HostUriRequestSchema.safeParse(raw);
        if (!parsed.success) {
            this.onFatal(new Error(`Invalid OMP host_uri_request: ${parsed.error.message}`));
            return;
        }
        const request = parsed.data;
        if (this.pending.has(request.id)) {
            this.onFatal(new Error(`Duplicate OMP host URI request id: ${request.id}`));
            return;
        }
        const controller = new AbortController();
        const pending: PendingHostUri = {
            request,
            controller,
            cancelled: false,
            timer: setTimeout(() => {
                controller.abort();
                void this.finish(pending, {
                    type: 'host_uri_result',
                    id: request.id,
                    isError: true,
                    error: `HAPI host URI ${request.operation} timed out after ${HOST_OPERATION_TIMEOUT_MS}ms`
                });
            }, HOST_OPERATION_TIMEOUT_MS)
        };
        pending.timer.unref();
        this.pending.set(request.id, pending);
        void this.execute(pending).catch((error) => this.onFatal(
            error instanceof Error ? error : new Error(String(error))
        ));
    }

    handleCancel(raw: JsonObject): void {
        const parsed = HostUriCancelSchema.safeParse(raw);
        if (!parsed.success) {
            this.onFatal(new Error(`Invalid OMP host_uri_cancel: ${parsed.error.message}`));
            return;
        }
        const pending = this.pending.get(parsed.data.targetId);
        if (!pending) return;
        pending.cancelled = true;
        clearTimeout(pending.timer);
        this.pending.delete(parsed.data.targetId);
        pending.controller.abort();
    }

    close(): void {
        for (const pending of this.pending.values()) {
            pending.cancelled = true;
            clearTimeout(pending.timer);
            pending.controller.abort();
        }
        this.pending.clear();
    }

    private async execute(pending: PendingHostUri): Promise<void> {
        let scheme: string;
        try {
            scheme = new URL(pending.request.url).protocol.slice(0, -1).toLowerCase();
        } catch {
            await this.finishError(pending, `Invalid host URI: ${pending.request.url}`);
            return;
        }
        const provider = this.providersByScheme.get(scheme);
        if (!provider) {
            await this.finishError(pending, `HAPI has no host URI provider for scheme: ${scheme}`);
            return;
        }

        try {
            if (pending.request.operation === 'read') {
                const result = await provider.read(pending.request.url, pending.controller.signal);
                await this.finish(pending, {
                    type: 'host_uri_result',
                    id: pending.request.id,
                    ...result
                });
                return;
            }
            if (!provider.write) {
                throw new Error(`HAPI host URI scheme is read-only: ${scheme}`);
            }
            await provider.write(
                pending.request.url,
                pending.request.content ?? '',
                pending.controller.signal
            );
            await this.finish(pending, { type: 'host_uri_result', id: pending.request.id });
        } catch (error) {
            if (pending.cancelled) return;
            await this.finishError(pending, errorText(error));
        }
    }

    private async finishError(pending: PendingHostUri, message: string): Promise<void> {
        await this.finish(pending, {
            type: 'host_uri_result',
            id: pending.request.id,
            isError: true,
            error: message
        });
    }

    private async finish(pending: PendingHostUri, frame: OmpOutboundControlFrame): Promise<void> {
        if (this.pending.get(pending.request.id) !== pending || pending.cancelled) return;
        clearTimeout(pending.timer);
        this.pending.delete(pending.request.id);
        await this.client.sendControlFrame(frame);
    }
}

type WaitedExtensionRequest = Extract<OmpExtensionUiRequest, {
    method: 'select' | 'confirm' | 'input' | 'editor';
}>;

type PendingExtensionRequest =
    | {
        kind: 'waited';
        request: WaitedExtensionRequest;
        arguments: JsonObject;
        createdAt: number;
        sensitive: boolean;
        timer?: ReturnType<typeof setTimeout>;
    }
    | {
        kind: 'open-url';
        request: Extract<OmpExtensionUiRequest, { method: 'open_url' }>;
        arguments: JsonObject;
        createdAt: number;
        sensitive: boolean;
        timer: ReturnType<typeof setTimeout>;
    };

type OmpExtensionUiBridgeOptions = {
    client: OmpRpcClient;
    updateAgentState: (handler: (state: AgentState) => AgentState) => void;
    sendAgentMessage: (message: unknown) => void;
    sendSummary: (title: string) => void;
    isLoginActive: () => boolean;
    onFatal: (error: Error) => void;
};

export class OmpExtensionUiBridge {
    private readonly pending = new Map<string, PendingExtensionRequest>();

    constructor(private readonly options: OmpExtensionUiBridgeOptions) {}

    handle(raw: JsonObject): void {
        const parsed = ExtensionUiRequestSchema.safeParse(raw);
        if (!parsed.success) {
            this.options.onFatal(new Error(`Invalid OMP extension_ui_request: ${parsed.error.message}`));
            return;
        }
        const request = parsed.data as OmpExtensionUiRequest;
        switch (request.method) {
            case 'select':
            case 'confirm':
            case 'input':
            case 'editor':
                this.addWaitedRequest(request);
                return;
            case 'cancel':
                this.cancelFromOmp(request.targetId);
                return;
            case 'notify':
                this.options.sendAgentMessage({
                    type: 'omp-extension-ui',
                    method: 'notify',
                    message: this.options.isLoginActive()
                        ? 'OMP provider login status updated'
                        : request.message,
                    level: request.notifyType ?? 'info'
                } satisfies OmpExtensionUiPresentationEvent);
                return;
            case 'setStatus':
                this.options.sendAgentMessage({
                    type: 'omp-extension-ui',
                    method: 'setStatus',
                    key: request.statusKey,
                    text: request.statusText ?? null
                } satisfies OmpExtensionUiPresentationEvent);
                return;
            case 'setWidget':
                this.options.sendAgentMessage({
                    type: 'omp-extension-ui',
                    method: 'setWidget',
                    key: request.widgetKey,
                    lines: request.widgetLines ?? [],
                    placement: request.widgetPlacement
                } satisfies OmpExtensionUiPresentationEvent);
                return;
            case 'setTitle':
                this.options.sendSummary(request.title);
                this.options.sendAgentMessage({
                    type: 'omp-extension-ui',
                    method: 'setTitle',
                    title: request.title
                } satisfies OmpExtensionUiPresentationEvent);
                return;
            case 'set_editor_text':
                this.options.sendAgentMessage({
                    type: 'omp-extension-ui',
                    method: 'set_editor_text',
                    text: request.text
                } satisfies OmpExtensionUiPresentationEvent);
                return;
            case 'open_url':
                this.addOpenUrlRequest(request);
                return;
            default: {
                const exhaustive: never = request;
                return exhaustive;
            }
        }
    }

    async handleWebResponse(raw: unknown): Promise<void> {
        const response = PermissionResponseSchema.parse(raw);
        const pending = this.pending.get(response.id);
        if (!pending) {
            throw new Error(`OMP extension UI request is no longer pending: ${response.id}`);
        }

        const decision = response.decision ?? (response.approved ? 'approved' : 'denied');
        const persistedAnswers = pending.kind === 'waited' && pending.sensitive
            ? undefined
            : response.answers;
        if (!response.approved || decision === 'denied' || decision === 'abort') {
            if (!this.complete(pending, 'canceled', decision, persistedAnswers)) return;
            if (pending.kind === 'waited') {
                await this.options.client.sendControlFrame({
                    type: 'extension_ui_response',
                    id: response.id,
                    cancelled: true
                });
            }
            return;
        }

        if (pending.kind === 'open-url') {
            this.complete(pending, 'approved', decision, response.answers);
            return;
        }

        const frame = this.responseFrame(pending.request, response.answers);
        if (!this.complete(pending, 'approved', decision, persistedAnswers)) return;
        await this.options.client.sendControlFrame(frame);
    }

    async close(reason: string): Promise<void> {
        const pending = Array.from(this.pending.values());
        for (const entry of pending) {
            if (!this.complete(entry, 'canceled', 'abort', undefined, reason)) continue;
            if (entry.kind === 'waited') {
                try {
                    await this.options.client.sendControlFrame({
                        type: 'extension_ui_response',
                        id: entry.request.id,
                        cancelled: true
                    });
                } catch (error) {
                    logger.debug('[omp-host] failed to cancel extension UI during close', error);
                }
            }
        }
    }

    private addWaitedRequest(request: WaitedExtensionRequest): void {
        if (this.pending.has(request.id)) {
            this.options.onFatal(new Error(`Duplicate OMP extension UI request id: ${request.id}`));
            return;
        }
        const entry: PendingExtensionRequest = {
            kind: 'waited',
            request,
            arguments: this.toRequestUserInput(request),
            createdAt: Date.now(),
            sensitive: this.options.isLoginActive()
        };
        if (request.method !== 'editor' && request.timeout !== undefined) {
            entry.timer = setTimeout(() => {
                void this.timeout(entry).catch(this.options.onFatal);
            }, request.timeout);
            entry.timer.unref();
        }
        this.pending.set(request.id, entry);
        this.publishPending(entry);
    }

    private addOpenUrlRequest(request: Extract<OmpExtensionUiRequest, { method: 'open_url' }>): void {
        if (this.pending.has(request.id)) {
            this.options.onFatal(new Error(`Duplicate OMP extension UI request id: ${request.id}`));
            return;
        }
        const target = this.safeWebUrl(request.launchUrl ?? request.url);
        const displayUrl = this.safeWebUrl(request.url);
        if (!target || !displayUrl) {
            this.options.sendAgentMessage({
                type: 'omp-extension-ui',
                method: 'notify',
                message: this.options.isLoginActive()
                    ? 'OMP requested an unsupported provider login URL'
                    : `OMP requested an unsupported URL scheme: ${request.url}`,
                level: 'error'
            } satisfies OmpExtensionUiPresentationEvent);
            return;
        }
        const sensitive = this.options.isLoginActive();
        const argumentsValue: JsonObject = {
            url: target,
            questions: [{
                id: '__mcp_url_confirmation',
                question: request.instructions ?? 'Open the provider login page in a new tab?',
                required: true,
                multiple: false,
                options: [{ label: 'Open login page', description: target }]
            }]
        };
        const entry: PendingExtensionRequest = {
            kind: 'open-url',
            request,
            arguments: argumentsValue,
            createdAt: Date.now(),
            sensitive,
            timer: setTimeout(() => {
                this.complete(entry, 'canceled', 'abort', undefined, 'Timed out');
            }, LOGIN_TIMEOUT_MS)
        };
        entry.timer.unref();
        this.pending.set(request.id, entry);
        this.publishPending(entry);
        this.options.sendAgentMessage({
            type: 'omp-extension-ui',
            method: 'open_url',
            url: sensitive ? this.redactLoginUrl(displayUrl) : displayUrl,
            ...(sensitive ? {} : { instructions: request.instructions })
        } satisfies OmpExtensionUiPresentationEvent);
    }

    private toRequestUserInput(request: WaitedExtensionRequest): JsonObject {
        switch (request.method) {
            case 'select':
                return {
                    questions: [{
                        id: 'value',
                        question: request.title,
                        required: true,
                        multiple: false,
                        options: request.options.map((label) => ({ label, description: null }))
                    }]
                };
            case 'confirm':
                return {
                    questions: [{
                        id: 'confirmed',
                        question: `${request.title}\n\n${request.message}`,
                        required: true,
                        multiple: false,
                        options: [
                            { label: 'Yes', description: null },
                            { label: 'No', description: null }
                        ]
                    }]
                };
            case 'input':
                return {
                    questions: [{
                        id: 'value',
                        question: request.title,
                        required: false,
                        multiple: false,
                        options: [],
                        placeholder: request.placeholder ?? null
                    }]
                };
            case 'editor':
                return {
                    questions: [{
                        id: 'value',
                        question: request.title,
                        required: false,
                        multiple: false,
                        options: [],
                        initialValue: request.prefill ?? '',
                        multiline: true
                    }]
                };
            default: {
                const exhaustive: never = request;
                return exhaustive;
            }
        }
    }

    private responseFrame(
        request: WaitedExtensionRequest,
        answers: z.infer<typeof PermissionResponseSchema>['answers']
    ): OmpOutboundControlFrame {
        switch (request.method) {
            case 'select':
                return { type: 'extension_ui_response', id: request.id, value: this.requiredAnswer(answers, 'value') };
            case 'confirm': {
                const answer = this.requiredAnswer(answers, 'confirmed');
                if (answer !== 'Yes' && answer !== 'No') {
                    throw new Error(`Invalid OMP confirm answer: ${answer}`);
                }
                return { type: 'extension_ui_response', id: request.id, confirmed: answer === 'Yes' };
            }
            case 'input':
            case 'editor':
                return { type: 'extension_ui_response', id: request.id, value: this.textAnswer(answers, 'value') };
            default: {
                const exhaustive: never = request;
                return exhaustive;
            }
        }
    }

    private requiredAnswer(
        answers: z.infer<typeof PermissionResponseSchema>['answers'],
        key: string
    ): string {
        const entry = answers?.[key];
        const values = Array.isArray(entry) ? entry : entry?.answers;
        if (!values) throw new Error(`OMP extension UI response is missing answer: ${key}`);
        const note = values.find((value) => value.startsWith('user_note: '));
        if (note) return note.slice('user_note: '.length);
        const value = values.find((candidate) => candidate.length > 0);
        if (value === undefined) throw new Error(`OMP extension UI response is empty: ${key}`);
        return value;
    }

    private textAnswer(
        answers: z.infer<typeof PermissionResponseSchema>['answers'],
        key: string
    ): string {
        const entry = answers?.[key];
        if (entry === undefined) {
            throw new Error(`OMP extension UI response is missing answer: ${key}`);
        }
        const values = Array.isArray(entry) ? entry : entry.answers;
        const note = values.find((value) => value.startsWith('user_note: '));
        if (note) return note.slice('user_note: '.length);
        return values[0] ?? '';
    }

    private async timeout(entry: Extract<PendingExtensionRequest, { kind: 'waited' }>): Promise<void> {
        if (this.pending.get(entry.request.id) !== entry) return;
        if (!this.complete(entry, 'canceled', 'abort', undefined, 'Timed out')) return;
        await this.options.client.sendControlFrame({
            type: 'extension_ui_response',
            id: entry.request.id,
            cancelled: true,
            timedOut: true
        });
    }

    private cancelFromOmp(targetId: string): void {
        const entry = this.pending.get(targetId);
        if (!entry) return;
        this.complete(entry, 'canceled', 'abort', undefined, 'Cancelled by OMP');
    }

    private publishPending(entry: PendingExtensionRequest): void {
        this.options.updateAgentState((state) => ({
            ...state,
            requests: {
                ...(state.requests ?? {}),
                [entry.request.id]: {
                    tool: 'request_user_input',
                    arguments: entry.arguments,
                    createdAt: entry.createdAt
                }
            }
        }));
    }

    private complete(
        entry: PendingExtensionRequest,
        status: 'approved' | 'canceled',
        decision: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        answers?: z.infer<typeof PermissionResponseSchema>['answers'],
        reason?: string
    ): boolean {
        if (this.pending.get(entry.request.id) !== entry) return false;
        if (entry.kind === 'waited') {
            if (entry.timer) clearTimeout(entry.timer);
        } else {
            clearTimeout(entry.timer);
        }
        this.pending.delete(entry.request.id);
        this.options.updateAgentState((state) => {
            const { [entry.request.id]: _, ...requests } = state.requests ?? {};
            return {
                ...state,
                requests,
                completedRequests: {
                    ...(state.completedRequests ?? {}),
                    [entry.request.id]: {
                        tool: 'request_user_input',
                        arguments: this.completedArguments(entry),
                        createdAt: entry.createdAt,
                        completedAt: Date.now(),
                        status,
                        decision,
                        ...(answers ? { answers } : {}),
                        ...(reason ? { reason } : {})
                    }
                }
            };
        });
        return true;
    }

    private completedArguments(entry: PendingExtensionRequest): JsonObject {
        if (entry.kind !== 'open-url' || !entry.sensitive) return entry.arguments;
        return {
            url: this.redactLoginUrl(entry.request.url),
            questions: [{
                id: '__mcp_url_confirmation',
                question: 'Open the provider login page in a new tab?',
                required: true,
                multiple: false,
                options: [{ label: 'Open login page', description: null }]
            }]
        };
    }

    private safeWebUrl(value: string): string | null {
        try {
            const parsed = new URL(value);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
        } catch {
            return null;
        }
    }

    private redactLoginUrl(value: string): string {
        return new URL(value).origin;
    }
}

export class OmpHostIntegration {
    private readonly hostTools: OmpHostToolBridge;
    private readonly hostUris: OmpHostUriBridge;
    private readonly extensionUi: OmpExtensionUiBridge;
    private loginActive = false;
    private loginProviders: OmpLoginProvider[] = [];
    private readonly authenticatedProviderIds = new Set<string>();
    private readonly client: OmpRpcClient;
    private readonly sessionClient: Pick<ApiSessionClient,
        'sendAgentMessage' | 'sendClaudeSessionMessage' | 'updateAgentState' | 'rpcHandlerManager'>;

    constructor(options: {
        client: OmpRpcClient;
        cwd: string;
        sessionClient: Pick<ApiSessionClient,
            'sendAgentMessage' | 'sendClaudeSessionMessage' | 'updateAgentState' | 'rpcHandlerManager'>;
        onFatal: (error: Error) => void;
        hostUriProviders?: OmpHostUriProvider[];
    }) {
        this.client = options.client;
        this.sessionClient = options.sessionClient;
        const sendSummary = (title: string) => options.sessionClient.sendClaudeSessionMessage({
            type: 'summary',
            summary: title,
            leafUuid: randomUUID()
        } satisfies RawJSONLines);
        this.hostTools = new OmpHostToolBridge({
            client: options.client,
            cwd: options.cwd,
            sendAgentMessage: (message) => options.sessionClient.sendAgentMessage(message),
            sendSummary,
            onFatal: options.onFatal
        });
        this.hostUris = new OmpHostUriBridge(
            options.client,
            options.hostUriProviders ?? [],
            options.onFatal
        );
        this.extensionUi = new OmpExtensionUiBridge({
            client: options.client,
            updateAgentState: (handler) => options.sessionClient.updateAgentState(handler),
            sendAgentMessage: (message) => options.sessionClient.sendAgentMessage(message),
            sendSummary,
            isLoginActive: () => this.loginActive,
            onFatal: options.onFatal
        });

        options.sessionClient.rpcHandlerManager.registerHandler(
            RPC_METHODS.Permission,
            async (response: unknown) => await this.extensionUi.handleWebResponse(response)
        );
        options.sessionClient.rpcHandlerManager.registerHandler<Record<string, never>, OmpLoginProvidersResponse>(
            RPC_METHODS.ListOmpLoginProviders,
            async () => await this.listLoginProviders()
        );
        options.sessionClient.rpcHandlerManager.registerHandler<StartOmpLoginRequest, StartOmpLoginResponse>(
            RPC_METHODS.StartOmpLogin,
            async (request) => await this.startLogin(request)
        );
    }

    async initialize(): Promise<{ hostToolNames: string[] }> {
        await this.hostTools.register();
        await this.hostUris.register();
        const providers = await this.listLoginProvidersFromClient();
        if (!providers.success) throw new Error(providers.error ?? 'Failed to discover OMP login providers');
        return { hostToolNames: HOST_TOOL_DEFINITIONS.map((tool) => tool.name) };
    }

    handle(event: { type: OmpHostIntegrationEvent['type']; raw: JsonObject }): void {
        switch (event.type) {
            case 'extension_ui_request':
                this.extensionUi.handle(event.raw);
                return;
            case 'host_tool_call':
                this.hostTools.handleCall(event.raw);
                return;
            case 'host_tool_cancel':
                this.hostTools.handleCancel(event.raw);
                return;
            case 'host_uri_request':
                this.hostUris.handleRequest(event.raw);
                return;
            case 'host_uri_cancel':
                this.hostUris.handleCancel(event.raw);
                return;
            default: {
                const exhaustive: never = event.type;
                return exhaustive;
            }
        }
    }

    async close(reason: string): Promise<void> {
        this.hostTools.close();
        this.hostUris.close();
        await this.extensionUi.close(reason);
    }

    private async listLoginProviders(): Promise<OmpLoginProvidersResponse> {
        if (this.loginActive) {
            return { success: true, providers: this.loginProviders, loginInProgress: true };
        }
        return await this.listLoginProvidersFromClient();
    }

    private async listLoginProvidersFromClient(): Promise<OmpLoginProvidersResponse> {
        try {
            const result = await this.client.request({ type: 'get_login_providers' });
            this.loginProviders = result.providers.map((provider) => (
                this.authenticatedProviderIds.has(provider.id)
                    ? { ...provider, authenticated: true }
                    : provider
            ));
            return { success: true, providers: this.loginProviders, loginInProgress: this.loginActive };
        } catch (error) {
            return { success: false, error: errorText(error), loginInProgress: this.loginActive };
        }
    }

    private async startLogin(
        raw: StartOmpLoginRequest
    ): Promise<StartOmpLoginResponse> {
        let request: StartOmpLoginRequest;
        try {
            request = StartLoginRequestSchema.parse(raw);
        } catch (error) {
            return { success: false, error: errorText(error) };
        }
        if (this.loginActive) {
            return { success: false, error: 'An OMP provider login is already in progress' };
        }
        const catalog = await this.listLoginProvidersFromClient();
        if (!catalog.success) return catalog;
        const provider = catalog.providers.find((candidate) => candidate.id === request.providerId);
        if (!provider?.available) {
            return { success: false, error: `OMP login provider is unavailable: ${request.providerId}` };
        }
        if (provider.authenticated) {
            return { success: true, provider, providers: catalog.providers };
        }

        this.loginActive = true;
        this.sessionClient.sendAgentMessage({
            type: 'omp-extension-ui',
            method: 'login_status',
            providerId: provider.id,
            status: 'started',
            message: `OMP login started for ${provider.name}`
        } satisfies OmpExtensionUiPresentationEvent);
        try {
            await this.client.request({ type: 'login', providerId: provider.id }, { timeoutMs: LOGIN_TIMEOUT_MS });
            // OMP may store an alternate login flow under another provider id
            // (for example openai-codex-device -> openai-codex) while its RPC
            // catalog still checks the login-flow id. A successful login command
            // is the authoritative completion signal for this live session.
            this.authenticatedProviderIds.add(provider.id);
            const refreshed = await this.listLoginProvidersFromClient();
            const providers = refreshed.success
                ? refreshed.providers
                : catalog.providers.map((candidate) => (
                    candidate.id === provider.id ? { ...candidate, authenticated: true } : candidate
                ));
            this.loginProviders = providers;
            const authenticated = providers.find((candidate) => candidate.id === provider.id)
                ?? { ...provider, authenticated: true };
            this.sessionClient.sendAgentMessage({
                type: 'omp-extension-ui',
                method: 'login_status',
                providerId: provider.id,
                status: 'authenticated',
                message: `OMP login completed for ${provider.name}`
            } satisfies OmpExtensionUiPresentationEvent);
            return {
                success: true,
                provider: authenticated,
                providers
            };
        } catch (error) {
            const message = errorText(error);
            this.sessionClient.sendAgentMessage({
                type: 'omp-extension-ui',
                method: 'login_status',
                providerId: provider.id,
                status: 'failed',
                message: `OMP login failed for ${provider.name}`
            } satisfies OmpExtensionUiPresentationEvent);
            return { success: false, error: message };
        } finally {
            this.loginActive = false;
        }
    }
}
