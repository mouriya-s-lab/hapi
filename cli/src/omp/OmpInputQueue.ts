import type { AttachmentMetadata } from '@/api/types';
import { logger } from '@/ui/logger';
import type { OmpInputMode } from '@hapi/protocol/types';
import type { OmpMode } from './types';

export type OmpQueuedInput = {
    id: number;
    text: string;
    attachments: AttachmentMetadata[];
    inputMode: OmpInputMode;
    mode: OmpMode;
    modeHash: string;
    localId?: string;
};

type HeldInput = OmpQueuedInput & {
    state: 'held' | 'invoking';
};

/**
 * OMP input cannot use MessageQueue2's string batches: native images and the
 * four RPC input commands must retain their type until invocation. A taken
 * item also remains cancelable while the launcher is holding it; only
 * beginInvocation() closes that cancellation window.
 */
export class OmpInputQueue {
    readonly queue: OmpQueuedInput[] = [];
    onBatchConsumed: ((localIds: string[]) => void) | null = null;

    private readonly held = new Map<number, HeldInput>();
    private readonly changeListeners = new Set<() => void>();
    private onMessageHandler: ((...args: unknown[]) => void) | null = null;
    private closed = false;
    private nextId = 0;

    constructor(private readonly modeHasher: (mode: OmpMode) => string) {}

    push(input: {
        text: string;
        attachments?: AttachmentMetadata[];
        inputMode: OmpInputMode;
        mode: OmpMode;
        localId?: string;
    }): void {
        if (this.closed) {
            throw new Error('Cannot push to closed OMP input queue');
        }
        const item: OmpQueuedInput = {
            id: ++this.nextId,
            text: input.text,
            attachments: input.attachments ?? [],
            inputMode: input.inputMode,
            mode: input.mode,
            modeHash: this.modeHasher(input.mode),
            ...(input.localId ? { localId: input.localId } : {})
        };
        this.queue.push(item);
        this.onMessageHandler?.(input.text, input.mode);
        this.emitChange();
    }

    take(): OmpQueuedInput | null {
        const input = this.queue.shift();
        if (!input) {
            return null;
        }
        this.held.set(input.id, { ...input, state: 'held' });
        this.emitChange();
        return input;
    }

    isHeld(input: OmpQueuedInput): boolean {
        return this.held.get(input.id)?.state === 'held';
    }

    beginInvocation(input: OmpQueuedInput): boolean {
        const held = this.held.get(input.id);
        if (!held || held.state !== 'held') {
            return false;
        }
        held.state = 'invoking';
        this.emitChange();
        return true;
    }

    completeInvocation(input: OmpQueuedInput): void {
        if (!this.held.delete(input.id)) {
            return;
        }
        if (input.localId) {
            this.onBatchConsumed?.([input.localId]);
        }
        this.emitChange();
    }

    cancelByLocalId(localId: string): boolean {
        if (!localId) {
            return false;
        }
        const queuedIndex = this.queue.findIndex((input) => input.localId === localId);
        if (queuedIndex >= 0) {
            this.queue.splice(queuedIndex, 1);
            this.emitChange();
            return true;
        }
        for (const [id, input] of this.held) {
            if (input.localId === localId && input.state === 'held') {
                this.held.delete(id);
                this.emitChange();
                return true;
            }
        }
        return false;
    }

    /** Put cancelable launcher-held input back ahead of untouched queue input. */
    requeueHeld(): void {
        const held = [...this.held.values()]
            .filter((input) => input.state === 'held')
            .sort((left, right) => left.id - right.id);
        if (held.length === 0) {
            return;
        }
        for (const input of held) {
            this.held.delete(input.id);
        }
        this.queue.unshift(...held.map(({ state: _state, ...input }) => input));
        this.emitChange();
    }

    size(): number {
        return this.queue.length;
    }

    heldSize(): number {
        return this.held.size;
    }

    reset(): void {
        logger.debug(`[OmpInputQueue] reset: queued=${this.queue.length} held=${this.held.size}`);
        this.queue.splice(0, this.queue.length);
        this.held.clear();
        this.closed = false;
        this.emitChange();
    }

    close(): void {
        this.closed = true;
        this.emitChange();
    }

    isClosed(): boolean {
        return this.closed;
    }

    setOnMessage(handler: ((...args: unknown[]) => void) | null): void {
        this.onMessageHandler = handler;
    }

    onChange(listener: () => void): () => void {
        this.changeListeners.add(listener);
        return () => this.changeListeners.delete(listener);
    }

    private emitChange(): void {
        for (const listener of this.changeListeners) {
            listener();
        }
    }
}
