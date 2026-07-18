import { describe, expect, it, vi } from 'vitest';
import { OmpInputQueue } from './OmpInputQueue';

const mode = { permissionMode: 'default' as const, model: 'test-model' };

describe('OmpInputQueue', () => {
    it('keeps launcher-held input cancelable until native invocation begins', () => {
        const queue = new OmpInputQueue(() => 'mode');
        const consumed = vi.fn();
        queue.onBatchConsumed = consumed;
        queue.push({ text: 'first', inputMode: 'follow_up', mode, localId: 'one' });
        queue.push({ text: 'second', inputMode: 'follow_up', mode, localId: 'two' });

        const first = queue.take();
        const second = queue.take();
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(queue.cancelByLocalId('two')).toBe(true);
        expect(queue.beginInvocation(first!)).toBe(true);
        expect(queue.cancelByLocalId('one')).toBe(false);
        expect(consumed).not.toHaveBeenCalled();

        queue.completeInvocation(first!);
        expect(consumed).toHaveBeenCalledWith(['one']);
        expect(queue.heldSize()).toBe(0);
    });

    it('requeues cancelable launcher-held input in original order on handoff', () => {
        const queue = new OmpInputQueue(() => 'mode');
        queue.push({ text: 'one', inputMode: 'prompt', mode, localId: 'one' });
        queue.push({ text: 'two', inputMode: 'prompt', mode, localId: 'two' });
        queue.take();
        queue.take();

        queue.requeueHeld();

        expect(queue.queue.map((input) => input.localId)).toEqual(['one', 'two']);
        expect(queue.heldSize()).toBe(0);
    });
});
