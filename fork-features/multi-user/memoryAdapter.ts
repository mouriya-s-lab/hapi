import type { MultiUserGatewayStore } from './gatewayStore'
import { gatewayAccountId } from './executionMount'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export function createGatewayMemoryDelivery(store: MultiUserGatewayStore): {
    metadataForAccount(accountId: number | null): Record<string, unknown>
    decorateForCli(content: unknown): unknown
} {
    return {
        metadataForAccount: accountId => accountId === null ? {} : { gatewayAccountId: accountId },
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
                `<hapi_user_context user="${account.username.replaceAll('"', '&quot;')}">`,
                'This is user-managed context injected by the HAPI gateway. Resolve first-person references using it:',
                memory,
                '</hapi_user_context>'
            ].join('\n')
            return { ...content, content: { ...inner, text: `${context}\n\n${inner.text}` } }
        }
    }
}

export async function gatewayMessageDeliveryMetadata(request: Request, secret: Uint8Array): Promise<Record<string, unknown>> {
    const accountId = await gatewayAccountId(request, secret)
    return accountId === null ? {} : { gatewayAccountId: accountId }
}
