import type { PiImageContent } from './types';

export type PiPreparedPrompt = {
    message: string;
    images: PiImageContent[];
    /** Monotonic arrival reservation assigned before asynchronous preparation. */
    outboundSequence: number;
    localId?: string;
};

/**
 * Small cancellable FIFO: HAPI owns queueing, Pi receives only real turns.
 *
 * A native steer can asynchronously degrade to a prompt after a later ordinary
 * prompt was prepared. Arrival reservations preserve original message order at
 * that boundary instead of using completion order.
 */
export class PiPromptQueue {
    private readonly entries: PiPreparedPrompt[] = [];

    enqueue(prompt: PiPreparedPrompt): void {
        const index = this.entries.findIndex((entry) => entry.outboundSequence > prompt.outboundSequence);
        if (index === -1) this.entries.push(prompt);
        else this.entries.splice(index, 0, prompt);
    }

    dequeue(): PiPreparedPrompt | undefined {
        return this.entries.shift();
    }

    cancelByLocalId(localId: string): boolean {
        if (!localId) return false;
        const index = this.entries.findIndex((entry) => entry.localId === localId);
        if (index === -1) return false;
        this.entries.splice(index, 1);
        return true;
    }

    /**
     * Remove and return a queued entry by localId — used to promote a message
     * into the active turn (explicit steer). Returns undefined when the entry
     * is absent (already dispatched, cancelled, or still preparing).
     */
    removeByLocalId(localId: string): PiPreparedPrompt | undefined {
        if (!localId) return undefined;
        const index = this.entries.findIndex((entry) => entry.localId === localId);
        if (index === -1) return undefined;
        const [entry] = this.entries.splice(index, 1);
        return entry;
    }

    get size(): number {
        return this.entries.length;
    }
}
