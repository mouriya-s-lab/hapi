import { z } from 'zod';
import type { Hono } from 'hono';
import { RpcTargetMissingError } from '../../sync/rpcGateway';
import type { Machine, SyncEngine } from '../../sync/syncEngine';
import type { WebAppEnv } from '../../web/middleware/auth';
import { requireMachine } from '../../web/routes/guards';

const OMP_UNAVAILABLE_ERROR = 'OMP is not available on this runner';

function hasOmpCapability(machine: Machine): boolean {
    return machine.metadata?.ompAvailable === true;
}

function rpcFailure(error: unknown, fallback: string): {
    body: { success: false; error: string };
    status: 409 | 500;
} {
    if (error instanceof RpcTargetMissingError) {
        return {
            body: { success: false, error: OMP_UNAVAILABLE_ERROR },
            status: 409
        };
    }

    return {
        body: {
            success: false,
            error: error instanceof Error ? error.message : fallback
        },
        status: 500
    };
}

const StartLoginRequestSchema = z.object({ providerId: z.string().trim().min(1) });
const LoginInputRequestSchema = z.object({
    flowId: z.string().uuid(),
    value: z.string().min(1)
});

export function registerOmpMachineRoutes(
    app: Hono<WebAppEnv>,
    getSyncEngine: () => SyncEngine | null
): void {
    app.get('/machines/:id/omp-login-providers', async (c) => {
        const engine = getSyncEngine();
        if (!engine) return c.json({ success: false, error: 'Not connected' }, 503);
        const machineId = c.req.param('id');
        const machine = requireMachine(c, engine, machineId);
        if (machine instanceof Response) return machine;
        if (!hasOmpCapability(machine)) {
            return c.json({ success: false, error: OMP_UNAVAILABLE_ERROR }, 409);
        }

        try {
            return c.json(await engine.listOmpLoginProvidersForMachine(machineId));
        } catch (error) {
            const failure = rpcFailure(error, 'Failed to list OMP login providers');
            return c.json(failure.body, failure.status);
        }
    });

    app.post('/machines/:id/omp-login', async (c) => {
        const engine = getSyncEngine();
        if (!engine) return c.json({ success: false, error: 'Not connected' }, 503);
        const machineId = c.req.param('id');
        const machine = requireMachine(c, engine, machineId);
        if (machine instanceof Response) return machine;
        if (!hasOmpCapability(machine)) {
            return c.json({ success: false, error: OMP_UNAVAILABLE_ERROR }, 409);
        }
        const parsed = StartLoginRequestSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) return c.json({ success: false, error: 'Invalid OMP login request' }, 400);

        try {
            return c.json(await engine.startOmpLoginForMachine(machineId, parsed.data.providerId));
        } catch (error) {
            const failure = rpcFailure(error, 'Failed to start OMP login');
            return c.json(failure.body, failure.status);
        }
    });

    app.post('/machines/:id/omp-login-input', async (c) => {
        const engine = getSyncEngine();
        if (!engine) return c.json({ success: false, error: 'Not connected' }, 503);
        const machineId = c.req.param('id');
        const machine = requireMachine(c, engine, machineId);
        if (machine instanceof Response) return machine;
        if (!hasOmpCapability(machine)) {
            return c.json({ success: false, error: OMP_UNAVAILABLE_ERROR }, 409);
        }
        const parsed = LoginInputRequestSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) return c.json({ success: false, error: 'Invalid OMP login input' }, 400);

        try {
            return c.json(await engine.respondOmpLoginInputForMachine(
                machineId,
                parsed.data.flowId,
                parsed.data.value
            ));
        } catch (error) {
            const failure = rpcFailure(error, 'Failed to submit OMP login input');
            return c.json(failure.body, failure.status);
        }
    });

    app.get('/machines/:id/omp-models', async (c) => {
        const engine = getSyncEngine();
        if (!engine) return c.json({ success: false, error: 'Not connected' }, 503);
        const machineId = c.req.param('id');
        const machine = requireMachine(c, engine, machineId);
        if (machine instanceof Response) return machine;
        if (!hasOmpCapability(machine)) {
            return c.json({ success: false, error: OMP_UNAVAILABLE_ERROR }, 409);
        }
        const cwd = (c.req.query('cwd') ?? '').trim();
        if (!cwd) return c.json({ success: false, error: 'cwd query parameter is required' }, 400);

        try {
            return c.json(await engine.listOmpModelsForMachine(machineId, cwd));
        } catch (error) {
            const failure = rpcFailure(error, 'Failed to list OMP models');
            return c.json(failure.body, failure.status);
        }
    });
}
