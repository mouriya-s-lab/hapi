type ShareMessage = {
    id: string
    role: string
    createdAt?: Date
    metadata?: {
        custom?: unknown
    }
}

function isShareTurnUserMessage(message: ShareMessage): boolean {
    if (message.role !== 'user') return false

    const custom = message.metadata?.custom as {
        status?: string
        invokedAt?: number | null
    } | undefined

    return custom?.status !== 'failed' && custom?.invokedAt !== null
}

export function shouldHideShareForRunningTurn(
    messages: readonly ShareMessage[],
    currentMessageId: string,
    threadIsRunning: boolean,
    runningSince = 0
): boolean {
    return buildShareHiddenByMessageId(messages, threadIsRunning, runningSince).has(currentMessageId)
}

export function buildShareHiddenByMessageId(
    messages: readonly ShareMessage[],
    threadIsRunning: boolean,
    runningSince = 0
): ReadonlySet<string> {
    if (!threadIsRunning) return new Set()

    const activeUserIndex = messages.findLastIndex(isShareTurnUserMessage)
    const hidden = new Set<string>()
    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index]
        if (!message) continue
        const createdAt = message.createdAt?.getTime() ?? 0
        if (runningSince > 0 && createdAt > 0 && createdAt < runningSince) continue
        if (activeUserIndex < 0 || index >= activeUserIndex) hidden.add(message.id)
    }
    return hidden
}
