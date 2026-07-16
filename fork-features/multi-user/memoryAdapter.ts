import type { MultiUserGatewayStore } from './gatewayStore'

let gatewayStore: MultiUserGatewayStore | null = null

export function configureGatewayMemory(store: MultiUserGatewayStore): void {
    gatewayStore = store
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export function decorateMessageForGatewayMemory(content: unknown): unknown {
    if (!gatewayStore || !isRecord(content) || content.role !== 'user') return content
    const meta = isRecord(content.meta) ? content.meta : null
    const accountId = typeof meta?.gatewayAccountId === 'number' ? meta.gatewayAccountId : null
    const inner = isRecord(content.content) ? content.content : null
    if (accountId === null || !inner || inner.type !== 'text' || typeof inner.text !== 'string') return content
    const account = gatewayStore.getAccount(accountId)
    const memory = account?.memory?.trim()
    if (!account || !memory) return content
    const context = [
        `<hapi_user_context user="${account.username.replaceAll('"', '&quot;')}">`,
        'This is user-managed context injected by the HAPI gateway. Resolve first-person references using it:',
        memory,
        '</hapi_user_context>'
    ].join('\n')
    return { ...content, content: { ...inner, text: `${context}\n\n${inner.text}` } }
}
