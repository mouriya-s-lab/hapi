import * as z from 'zod'

export const changelogEntrySchema = z.object({
    hash: z.string().regex(/^[0-9a-f]{40}$/),
    date: z.string(),
    subject: z.string().min(1),
})

export const changelogSchema = z.object({
    version: z.string(),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    builtAt: z.string(),
    entries: z.array(changelogEntrySchema),
})

export type ChangelogEntry = z.infer<typeof changelogEntrySchema>

export type IncomingChanges =
    | { status: 'idle' | 'loading' }
    | { status: 'ready'; entries: ChangelogEntry[] }
    | { status: 'error' }

export function selectIncomingChanges(payload: unknown, currentCommit: string): ChangelogEntry[] {
    const changelog = changelogSchema.parse(payload)
    const currentIndex = changelog.entries.findIndex((entry) => entry.hash === currentCommit)

    if (currentIndex === -1) {
        throw new Error(`Current commit ${currentCommit} is absent from the incoming changelog`)
    }

    return changelog.entries.slice(0, currentIndex)
}
