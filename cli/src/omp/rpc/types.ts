export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

import type {
    OmpConfiguredThinkingLevel,
    OmpEffort,
    OmpThinkingLevel
} from '@hapi/protocol/omp';

export { OMP_EFFORT_LEVELS, OMP_THINKING_LEVELS } from '@hapi/protocol/omp';
export type { OmpConfiguredThinkingLevel, OmpEffort, OmpThinkingLevel } from '@hapi/protocol/omp';
export type OmpQueueMode = 'all' | 'one-at-a-time';
export type OmpInterruptMode = 'immediate' | 'wait';
export type OmpSubagentSubscriptionLevel = 'off' | 'progress' | 'events';

export type OmpImageContent = {
    type: 'image';
    data: string;
    mimeType: string;
    detail?: 'auto' | 'low' | 'high' | 'original';
};

export type OmpTodoItem = {
    content: string;
    status: 'pending' | 'in_progress' | 'completed' | 'abandoned';
};

export type OmpTodoPhase = {
    name: string;
    tasks: OmpTodoItem[];
};

export type OmpHostToolDefinition = {
    name: string;
    label?: string;
    description: string;
    parameters: JsonObject;
    hidden?: boolean;
    loadMode?: 'always' | 'discoverable' | 'deferred';
};

export type OmpHostUriSchemeDefinition = {
    scheme: string;
    description?: string;
    writable?: boolean;
    immutable?: boolean;
};

export type OmpCommand =
    | { type: 'prompt'; message: string; images?: OmpImageContent[]; streamingBehavior?: 'steer' | 'followUp' }
    | { type: 'steer'; message: string; images?: OmpImageContent[] }
    | { type: 'follow_up'; message: string; images?: OmpImageContent[] }
    | { type: 'abort' }
    | { type: 'abort_and_prompt'; message: string; images?: OmpImageContent[] }
    | { type: 'new_session'; parentSession?: string }
    | { type: 'get_state' }
    | { type: 'get_available_commands' }
    | { type: 'set_todos'; phases: OmpTodoPhase[] }
    | { type: 'set_host_tools'; tools: OmpHostToolDefinition[] }
    | { type: 'set_host_uri_schemes'; schemes: OmpHostUriSchemeDefinition[] }
    | { type: 'set_subagent_subscription'; level: OmpSubagentSubscriptionLevel }
    | { type: 'get_subagents' }
    | { type: 'get_subagent_messages'; subagentId?: string; sessionFile?: string; fromByte?: number }
    | { type: 'set_model'; provider: string; modelId: string }
    | { type: 'cycle_model' }
    | { type: 'get_available_models' }
    | { type: 'set_thinking_level'; level: OmpThinkingLevel }
    | { type: 'cycle_thinking_level' }
    | { type: 'set_steering_mode'; mode: OmpQueueMode }
    | { type: 'set_follow_up_mode'; mode: OmpQueueMode }
    | { type: 'set_interrupt_mode'; mode: OmpInterruptMode }
    | { type: 'compact'; customInstructions?: string }
    | { type: 'set_auto_compaction'; enabled: boolean }
    | { type: 'set_auto_retry'; enabled: boolean }
    | { type: 'abort_retry' }
    | { type: 'bash'; command: string }
    | { type: 'abort_bash' }
    | { type: 'get_session_stats' }
    | { type: 'export_html'; outputPath?: string }
    | { type: 'switch_session'; sessionPath: string }
    | { type: 'branch'; entryId: string }
    | { type: 'get_branch_messages' }
    | { type: 'get_last_assistant_text' }
    | { type: 'set_session_name'; name: string }
    | { type: 'handoff'; customInstructions?: string }
    | { type: 'get_messages' }
    | { type: 'get_login_providers' }
    | { type: 'login'; providerId: string };

export type OmpCommandType = OmpCommand['type'];
export type OmpCommandByType<C extends OmpCommandType> = Extract<OmpCommand, { type: C }>;
export type OmpCommandWithId = OmpCommand & { id: string };

export type OmpModel = {
    id: string;
    name: string;
    api: string;
    provider: string;
    baseUrl: string;
    reasoning: boolean;
    input: Array<'text' | 'image'>;
    contextWindow: number | null;
    maxTokens: number | null;
    thinking?: {
        mode: string;
        efforts: OmpEffort[];
        defaultLevel?: OmpEffort;
    };
    raw: JsonObject;
};

export type OmpContextUsage = {
    tokens: number;
    contextWindow: number;
    percent: number;
};

export type OmpSessionState = {
    model?: OmpModel;
    thinkingLevel?: OmpThinkingLevel;
    isStreaming: boolean;
    isCompacting: boolean;
    steeringMode: OmpQueueMode;
    followUpMode: OmpQueueMode;
    interruptMode: OmpInterruptMode;
    sessionFile?: string;
    sessionId: string;
    sessionName?: string;
    autoCompactionEnabled: boolean;
    messageCount: number;
    queuedMessageCount: number;
    todoPhases: OmpTodoPhase[];
    systemPrompt?: string[];
    dumpTools?: Array<{
        name: string;
        description: string;
        parameters: JsonValue;
        examples?: JsonValue[];
    }>;
    contextUsage?: OmpContextUsage;
};

export type OmpAvailableCommand = {
    name: string;
    aliases?: string[];
    description?: string;
    input?: { hint?: string };
    subcommands?: Array<{ name: string; description?: string; usage?: string }>;
    source: string;
};

export type OmpSubagentSnapshot = {
    id: string;
    index: number;
    agent: string;
    agentSource: string;
    description?: string;
    status: string;
    task?: string;
    assignment?: string;
    sessionFile?: string;
    lastUpdate: number;
    progress?: JsonObject;
    parentToolCallId?: string;
};

export type OmpAgentMessage = {
    role: string;
    raw: JsonObject;
};

export type OmpSubagentMessages = {
    sessionFile: string;
    fromByte: number;
    nextByte: number;
    reset: boolean;
    entries: JsonObject[];
    messages: OmpAgentMessage[];
};

export type OmpCompactionResult = {
    summary: string;
    shortSummary?: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    details?: JsonValue;
    preserveData?: JsonObject;
};

export type OmpBashResult = {
    output: string;
    exitCode?: number;
    cancelled: boolean;
    timedOut?: boolean;
    truncated: boolean;
    totalLines: number;
    totalBytes: number;
    outputLines: number;
    outputBytes: number;
    artifactId?: string;
    workingDir?: string;
};

export type OmpSessionStats = {
    sessionFile?: string;
    sessionId: string;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    toolResults: number;
    totalMessages: number;
    tokens: {
        input: number;
        output: number;
        reasoning: number;
        cacheRead: number;
        cacheWrite: number;
        total: number;
    };
    premiumRequests: number;
    cost: number;
    contextUsage?: OmpContextUsage;
};

export type OmpLoginProvider = {
    id: string;
    name: string;
    available: boolean;
    authenticated: boolean;
};

export type OmpResponseDataByCommand = {
    prompt: { agentInvoked: boolean } | undefined;
    steer: undefined;
    follow_up: undefined;
    abort: undefined;
    abort_and_prompt: undefined;
    new_session: { cancelled: boolean };
    get_state: OmpSessionState;
    get_available_commands: { commands: OmpAvailableCommand[] };
    set_todos: { todoPhases: OmpTodoPhase[] };
    set_host_tools: { toolNames: string[] };
    set_host_uri_schemes: { schemes: string[] };
    set_subagent_subscription: { level: OmpSubagentSubscriptionLevel };
    get_subagents: { subagents: OmpSubagentSnapshot[] };
    get_subagent_messages: OmpSubagentMessages;
    set_model: OmpModel;
    cycle_model: { model: OmpModel; thinkingLevel?: OmpThinkingLevel; isScoped: boolean } | null;
    get_available_models: { models: OmpModel[] };
    set_thinking_level: undefined;
    cycle_thinking_level: { level: OmpConfiguredThinkingLevel } | null;
    set_steering_mode: undefined;
    set_follow_up_mode: undefined;
    set_interrupt_mode: undefined;
    compact: OmpCompactionResult;
    set_auto_compaction: undefined;
    set_auto_retry: undefined;
    abort_retry: undefined;
    bash: OmpBashResult;
    abort_bash: undefined;
    get_session_stats: OmpSessionStats;
    export_html: { path: string };
    switch_session: { cancelled: boolean };
    branch: { text: string; cancelled: boolean };
    get_branch_messages: { messages: Array<{ entryId: string; text: string }> };
    get_last_assistant_text: { text: string | null };
    set_session_name: undefined;
    handoff: { savedPath?: string } | null;
    get_messages: { messages: OmpAgentMessage[] };
    get_login_providers: { providers: OmpLoginProvider[] };
    login: { providerId: string };
};

export type OmpResponseData<C extends OmpCommandType> = OmpResponseDataByCommand[C];

export type OmpRpcRawResponse =
    | {
        type: 'response';
        id?: string;
        command: string;
        success: true;
        data?: JsonValue;
    }
    | {
        type: 'response';
        id?: string;
        command: string;
        success: false;
        error: string;
    };

export type OmpInboundEvent = {
    type: string;
    raw: JsonObject;
};

export type OmpRpcTransportState = 'starting' | 'discovering' | 'ready' | 'closing' | 'closed';

export type OmpRpcDiscovery = {
    version: string;
    state: OmpSessionState;
    commands: OmpAvailableCommand[];
    models: OmpModel[];
};

type OmpRpcSpawnBaseConfig = {
    command?: string;
    cwd: string;
    env?: NodeJS.ProcessEnv;
    provider?: string;
    model?: string;
    profile?: string;
};

export type OmpRpcSpawnConfig = OmpRpcSpawnBaseConfig & (
    | { resumeSessionId?: undefined; forkSessionId?: undefined }
    | { resumeSessionId: string; forkSessionId?: never }
    | { forkSessionId: string; resumeSessionId?: never }
);
