import type { MultiUserGatewayStore } from './gatewayStore'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const OPEN_TAG = '<hapi_user_context'
const CLOSE_TAG = '</hapi_user_context>'

/**
 * Removes injected gateway-memory blocks from a piece of text.
 *
 * A CLI derives its session-title fallback from the first prompt it received,
 * which is the copy this adapter decorated — so the title otherwise ends up as
 * a truncated slice of the memory block. The slice usually stops mid-block, so
 * an unterminated opening tag (and a partial tag cut mid-word) must be dropped
 * to the end of the string as well.
 */
export function stripGatewayMemoryContext(text: string): string {
    let out = ''
    let rest = text
    for (;;) {
        const open = rest.indexOf(OPEN_TAG)
        if (open === -1) {
            out += rest
            break
        }
        out += rest.slice(0, open)
        const close = rest.indexOf(CLOSE_TAG, open)
        if (close === -1) {
            break
        }
        rest = rest.slice(close + CLOSE_TAG.length)
    }
    return dropTrailingPartialOpenTag(out).trim()
}

function dropTrailingPartialOpenTag(text: string): string {
    const start = text.lastIndexOf('<')
    if (start === -1) return text
    const tail = text.slice(start)
    return tail.length < OPEN_TAG.length && OPEN_TAG.startsWith(tail) ? text.slice(0, start) : text
}

export function containsGatewayMemoryContext(text: string): boolean {
    return stripGatewayMemoryContext(text) !== text.trim()
}

export function createGatewayMemoryDelivery(store: MultiUserGatewayStore): {
    decorateForCli(content: unknown): unknown
    sanitizeMetadata(metadata: unknown): unknown
} {
    return {
        decorateForCli(content) {
            if (!isRecord(content) || content.role !== 'user') return content
            const meta = isRecord(content.meta) ? content.meta : null
            const accountId = typeof meta?.gatewayAccountId === 'number' ? meta.gatewayAccountId : null
            const inner = isRecord(content.content) ? content.content : null
            if (accountId === null || !inner || inner.type !== 'text' || typeof inner.text !== 'string') return content
            const account = store.getAccount(accountId)
            const memory = account?.memory?.trim()
            if (!account || !memory) return content
            const context = [
                `${OPEN_TAG} user="${account.username.replaceAll('"', '&quot;')}">`,
                'This is user-managed context injected by the HAPI gateway. Resolve first-person references using it:',
                memory,
                CLOSE_TAG
            ].join('\n')
            return { ...content, content: { ...inner, text: `${context}\n\n${inner.text}` } }
        },

        /**
         * Drops injected memory that leaked back into a session title. Keys whose
         * whole value was the injected block are removed rather than blanked, so
         * the session keeps falling back to its directory name instead of showing
         * an empty title.
         */
        sanitizeMetadata(metadata) {
            if (!isRecord(metadata)) return metadata
            let next: Record<string, unknown> | null = null

            if (typeof metadata.name === 'string' && containsGatewayMemoryContext(metadata.name)) {
                const cleaned = stripGatewayMemoryContext(metadata.name)
                next = { ...metadata }
                if (cleaned) next.name = cleaned
                else delete next.name
            }

            const summary = isRecord(metadata.summary) ? metadata.summary : null
            if (summary && typeof summary.text === 'string' && containsGatewayMemoryContext(summary.text)) {
                const cleaned = stripGatewayMemoryContext(summary.text)
                next = next ?? { ...metadata }
                if (cleaned) next.summary = { ...summary, text: cleaned }
                else delete next.summary
            }

            return next ?? metadata
        }
    }
}
