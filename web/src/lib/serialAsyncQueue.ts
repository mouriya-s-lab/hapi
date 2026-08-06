/**
 * FIFO chain for async work that must not overlap (e.g. Cursor setModel RPCs).
 * Failures in one run do not break later enqueues.
 */
export function createSerialAsyncQueue(): (run: () => Promise<void>) => Promise<void> {
    let chain: Promise<void> = Promise.resolve()
    return (run) => {
        const pending = chain.then(run, run)
        chain = pending.then(() => undefined, () => undefined)
        return pending
    }
}
