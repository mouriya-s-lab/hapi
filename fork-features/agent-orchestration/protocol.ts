import { z } from 'zod'
import { AgentFlavorSchema } from '@hapi/protocol'
import {
    DecryptedMessageSchema,
    PermissionModeSchema,
    WorktreeMetadataSchema
} from '@hapi/protocol/schemas'

export const AgentStatusSchema = z.enum(['idle', 'working', 'blocked', 'dead'])
export type AgentStatus = z.infer<typeof AgentStatusSchema>

export const AgentErrorCodeSchema = z.enum([
    'not_found',
    'scope_denied',
    'timeout',
    'agent_prompt_stalled',
    'dead_target',
    'auth_failed',
    'bad_args',
    'not_hapi_session',
    'spawn_failed',
    'stop_failed',
    'internal_error'
])
export type AgentErrorCode = z.infer<typeof AgentErrorCodeSchema>

export const AgentErrorResponseSchema = z.object({
    error: z.object({
        code: AgentErrorCodeSchema,
        message: z.string()
    })
})
export type AgentErrorResponse = z.infer<typeof AgentErrorResponseSchema>

const TimeoutMsSchema = z.number().int().positive().max(600_000)
const CallerSchema = z.string().min(1)

export const AgentSpawnRequestSchema = z.object({
    caller: CallerSchema,
    directory: z.string().min(1),
    agent: AgentFlavorSchema,
    model: z.string().min(1).optional(),
    timeoutMs: TimeoutMsSchema.optional()
})

export const AgentPromptRequestSchema = z.object({
    caller: CallerSchema,
    text: z.string().min(1),
    wait: z.boolean().optional(),
    until: AgentStatusSchema.optional(),
    timeoutMs: TimeoutMsSchema.optional()
})

export const AgentWaitRequestSchema = z.object({
    caller: CallerSchema,
    until: AgentStatusSchema.optional(),
    timeoutMs: TimeoutMsSchema.optional()
})

export const AgentCallerRequestSchema = z.object({
    caller: CallerSchema
})

export const AgentMessageQuerySchema = z.object({
    caller: CallerSchema,
    raw: z.union([z.literal('1'), z.literal('true')]).optional()
})

export const AgentPendingRequestSchema = z.object({
    tool: z.string(),
    summary: z.string()
})

export const AgentSessionSummarySchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    flavor: z.string().nullable(),
    path: z.string(),
    machineId: z.string(),
    status: AgentStatusSchema,
    updatedAt: z.number()
})
export type AgentSessionSummary = z.infer<typeof AgentSessionSummarySchema>

export const AgentSessionDetailsSchema = AgentSessionSummarySchema.extend({
    worktree: WorktreeMetadataSchema.optional(),
    model: z.string().nullable(),
    permissionMode: PermissionModeSchema.optional(),
    pendingRequest: AgentPendingRequestSchema.optional()
})
export type AgentSessionDetails = z.infer<typeof AgentSessionDetailsSchema>

const ProjectedMessageBaseSchema = z.object({
    seq: z.number().nullable(),
    createdAt: z.number()
})

export const AgentProjectedMessageSchema = z.discriminatedUnion('kind', [
    ProjectedMessageBaseSchema.extend({
        kind: z.literal('user'),
        text: z.string(),
        sentFrom: z.string().optional(),
        fromSessionId: z.string().optional()
    }),
    ProjectedMessageBaseSchema.extend({
        kind: z.literal('assistant'),
        text: z.string()
    }),
    ProjectedMessageBaseSchema.extend({
        kind: z.literal('tool'),
        name: z.string(),
        summary: z.string()
    }),
    ProjectedMessageBaseSchema.extend({
        kind: z.literal('other'),
        summary: z.string()
    })
])
export type AgentProjectedMessage = z.infer<typeof AgentProjectedMessageSchema>

export const AgentMessagesPageSchema = z.object({
    direction: z.enum(['latest', 'before', 'after']),
    limit: z.number(),
    epoch: z.number(),
    reset: z.boolean(),
    nextBeforeSeq: z.number().nullable(),
    nextBeforeAt: z.number().nullable(),
    nextAfterSeq: z.number().nullable(),
    nextAfterAt: z.number().nullable(),
    snapshotHeadSeq: z.number().nullable(),
    snapshotHeadAt: z.number().nullable(),
    hasMore: z.boolean()
})

export const AgentListResponseSchema = z.object({
    sessions: z.array(AgentSessionSummarySchema)
})

export const AgentGetResponseSchema = z.object({
    session: AgentSessionDetailsSchema
})

export const AgentReadResponseSchema = z.discriminatedUnion('raw', [
    z.object({
        raw: z.literal(false),
        messages: z.array(AgentProjectedMessageSchema),
        page: AgentMessagesPageSchema
    }),
    z.object({
        raw: z.literal(true),
        messages: z.array(DecryptedMessageSchema),
        page: AgentMessagesPageSchema
    })
])

export const AgentStartResponseSchema = z.object({
    sessionId: z.string(),
    machineId: z.string(),
    status: AgentStatusSchema
})

export const AgentStatusResponseSchema = z.object({
    sessionId: z.string(),
    status: AgentStatusSchema
})
