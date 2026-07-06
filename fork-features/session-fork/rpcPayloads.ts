import { z } from 'zod'
import { MetadataSchema } from '../../shared/src/schemas'

/**
 * `forkPoint` is the per-message rewind target. `messageId` is the UI/UX
 * primary key (source-session hub message id); `tailOffset` is a
 * provider-agnostic number — how many user turns lie strictly after the
 * fork-point in the source session — computed by hub controller from the
 * source's messages table and mapped by each ForkProvider to its provider-
 * native fork parameter (Codex: `ThreadForkParams.numTurns`). Absent =>
 * HEAD fork (backward-compatible with #55).
 */
export const ForkPointSchema = z.object({
    messageId: z.string(),
    tailOffset: z.number().int().nonnegative()
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
    metadataPatch: MetadataSchema.partial()
})
export type ForkSpawnResult = z.infer<typeof ForkSpawnResultSchema>
