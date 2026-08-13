import { describe, expect, it } from 'vitest';
import { PiPromptQueue } from './promptQueue';

describe('PiPromptQueue', () => {
    it('preserves FIFO and permits cancellation before a Pi turn starts', () => {
        const queue = new PiPromptQueue();
        queue.enqueue({ message: 'first', images: [], outboundSequence: 1, localId: 'one' });
        queue.enqueue({ message: 'cancel', images: [], outboundSequence: 2, localId: 'two' });
        queue.enqueue({ message: 'third', images: [], outboundSequence: 3, localId: 'three' });
        expect(queue.cancelByLocalId('two')).toBe(true);
        expect(queue.dequeue()?.message).toBe('first');
        expect(queue.dequeue()?.message).toBe('third');
        expect(queue.dequeue()).toBeUndefined();
    });

    it('inserts a delayed steer fallback ahead of a later ordinary prompt', () => {
        const queue = new PiPromptQueue();
        queue.enqueue({ message: 'later ordinary', images: [], outboundSequence: 2, localId: 'two' });
        queue.enqueue({ message: 'earlier steer fallback', images: [], outboundSequence: 1, localId: 'one' });

        expect(queue.dequeue()?.message).toBe('earlier steer fallback');
        expect(queue.dequeue()?.message).toBe('later ordinary');
    });

    it('removes a queued entry by localId for explicit steer promotion', () => {
        const queue = new PiPromptQueue();
        queue.enqueue({ message: 'first', images: [], outboundSequence: 1, localId: 'one' });
        queue.enqueue({ message: 'steer me', images: [], outboundSequence: 2, localId: 'two' });
        queue.enqueue({ message: 'third', images: [], outboundSequence: 3, localId: 'three' });

        const removed = queue.removeByLocalId('two');
        expect(removed?.message).toBe('steer me');
        expect(removed?.localId).toBe('two');
        // Remaining order preserved.
        expect(queue.dequeue()?.message).toBe('first');
        expect(queue.dequeue()?.message).toBe('third');
        expect(queue.dequeue()).toBeUndefined();
    });

    it('returns undefined when removing an absent or already-dispatched localId', () => {
        const queue = new PiPromptQueue();
        queue.enqueue({ message: 'only', images: [], outboundSequence: 1, localId: 'one' });

        expect(queue.removeByLocalId('missing')).toBeUndefined();
        expect(queue.removeByLocalId('')).toBeUndefined();
        expect(queue.removeByLocalId('one')?.message).toBe('only');
        expect(queue.removeByLocalId('one')).toBeUndefined();
    });
});
