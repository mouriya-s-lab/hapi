import { z } from 'zod'
import { MetadataSchema } from '../../shared/src/schemas'

/**
 * `forkPoint` is the per-message rewind target.
 *
 * - `messageId` — UI/UX primary key = source-session hub message id.
 * - `tailOffset` — how many user turns lie strictly after the fork-point
 *   in the source session; used by count-based providers (Codex →
 *   Codex provider resolves this against `thread/read` to a `lastTurnId`).
 * - `providerMessageId` — opaque provider-native id computed by hub for
 *   id-based providers. For Claude, this is the *assistant* message uuid
 *   from the source jsonl transcript immediately preceding the target
 *   user message, and is passed to `claude --resume-session-at
 *   <providerMessageId>` alongside `--fork-session --resume <sid>`
 *   (Claude's undocumented per-message fork surface, discovered via
 *   binary `strings` after `--help` proved incomplete). Also fits future
 *   id-based providers like OpenCode (`Session.fork({messageID})`).
 *
 * Absent forkPoint => HEAD fork (backward-compatible with #55).
 */
export const ForkPointSchema = z.object({
    messageId: z.string(),
    tailOffset: z.number().int().nonnegative(),
    providerAnchor: z.discriminatedUnion('type', [
        z.object({ type: z.literal('message-uuid'), messageUuid: z.string() }),
        z.object({ type: z.literal('assistant-api-message-id'), assistantMessageId: z.string() })
    ]).optional(),
    isFirstUserTurn: z.boolean()
})
export type ForkPoint = z.infer<typeof ForkPointSchema>

export const ForkSpawnPayloadSchema = z.object({
    sourceMetadata: MetadataSchema,
    sourceCwd: z.string(),
    sourceModel: z.string().optional(),
    sourcePermissionMode: z.string().optional(),
    sourceCollaborationMode: z.string().optional(),
    forkPoint: ForkPointSchema.optional()
})
export type ForkSpawnPayload = z.infer<typeof ForkSpawnPayloadSchema>

export const ForkSpawnResultSchema = z.object({
    providerSessionId: z.string(),
    metadataPatch: MetadataSchema.partial(),
    claudeLaunch: z.discriminatedUnion('type', [
        z.object({ type: z.literal('fresh') }),
        z.object({
            type: z.literal('resume-at'),
            sourceSessionId: z.string(),
            providerMessageId: z.string()
        })
    ]).optional()
})
export type ForkSpawnResult = z.infer<typeof ForkSpawnResultSchema>
