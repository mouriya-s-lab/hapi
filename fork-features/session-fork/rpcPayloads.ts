import { z } from 'zod'
import { MetadataSchema } from '../../shared/src/schemas'

export const ForkSpawnPayloadSchema = z.object({
    sourceMetadata: MetadataSchema,
    sourceCwd: z.string(),
    sourceModel: z.string().optional(),
    sourcePermissionMode: z.string().optional(),
    sourceCollaborationMode: z.string().optional(),
    newHapiSessionId: z.string()
})
export type ForkSpawnPayload = z.infer<typeof ForkSpawnPayloadSchema>

export const ForkSpawnResultSchema = z.object({
    providerSessionId: z.string(),
    metadataPatch: MetadataSchema.partial()
})
export type ForkSpawnResult = z.infer<typeof ForkSpawnResultSchema>
