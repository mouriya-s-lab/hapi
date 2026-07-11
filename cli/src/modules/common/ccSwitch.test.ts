import { afterEach, describe, expect, it } from 'vitest';
import { runUsageScript } from './ccSwitch';

const originalFetch = globalThis.fetch;

function fetchStub(handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): typeof fetch {
    return Object.assign(handler, { preconnect: originalFetch.preconnect });
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('runUsageScript', () => {
    it('applies the VM timeout to the response extractor', async () => {
        globalThis.fetch = fetchStub(async () => new Response('{}', {
            headers: { 'content-type': 'application/json' }
        }));

        const result = runUsageScript({
            timeout: 0.001,
            code: `({
                request: { url: 'https://usage.invalid' },
                extractor: () => { while (true) {} }
            })`
        }, 'unused');

        await expect(result).rejects.toThrow('Script execution timed out');
    });

    it('normalizes a bounded extractor result', async () => {
        globalThis.fetch = fetchStub(async () => Response.json({ total: 12, remaining: 7 }));

        await expect(runUsageScript({
            timeout: 1,
            code: `({
                request: { url: 'https://usage.invalid' },
                extractor: (response) => ({
                    planName: 'Pro',
                    total: response.total,
                    remaining: response.remaining,
                    unit: 'requests',
                    isValid: true,
                    invalidMessage: null
                })
            })`
        }, 'unused')).resolves.toEqual({
            planName: 'Pro',
            total: 12,
            remaining: 7,
            unit: 'requests',
            isValid: true,
            invalidMessage: null
        });
    });
});
