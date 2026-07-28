import { z } from 'zod';
import type { Hono } from 'hono';
import type { SyncEngine } from '../../sync/syncEngine';
import type { WebAppEnv } from '../../web/middleware/auth';
import { requireMachine } from '../../web/routes/guards';

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

        try {
            return c.json(await engine.listOmpLoginProvidersForMachine(machineId));
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list OMP login providers'
            }, 500);
        }
    });

    app.post('/machines/:id/omp-login', async (c) => {
        const engine = getSyncEngine();
        if (!engine) return c.json({ success: false, error: 'Not connected' }, 503);
        const machineId = c.req.param('id');
        const machine = requireMachine(c, engine, machineId);
        if (machine instanceof Response) return machine;
        const parsed = StartLoginRequestSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) return c.json({ success: false, error: 'Invalid OMP login request' }, 400);

        try {
            return c.json(await engine.startOmpLoginForMachine(machineId, parsed.data.providerId));
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to start OMP login'
            }, 500);
        }
    });

    app.post('/machines/:id/omp-login-input', async (c) => {
        const engine = getSyncEngine();
        if (!engine) return c.json({ success: false, error: 'Not connected' }, 503);
        const machineId = c.req.param('id');
        const machine = requireMachine(c, engine, machineId);
        if (machine instanceof Response) return machine;
        const parsed = LoginInputRequestSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) return c.json({ success: false, error: 'Invalid OMP login input' }, 400);

        try {
            return c.json(await engine.respondOmpLoginInputForMachine(
                machineId,
                parsed.data.flowId,
                parsed.data.value
            ));
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to submit OMP login input'
            }, 500);
        }
    });

    app.get('/machines/:id/omp-models', async (c) => {
        const engine = getSyncEngine();
        if (!engine) return c.json({ success: false, error: 'Not connected' }, 503);
        const machineId = c.req.param('id');
        const machine = requireMachine(c, engine, machineId);
        if (machine instanceof Response) return machine;
        const cwd = (c.req.query('cwd') ?? '').trim();
        if (!cwd) return c.json({ success: false, error: 'cwd query parameter is required' }, 400);

        try {
            return c.json(await engine.listOmpModelsForMachine(machineId, cwd));
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list OMP models'
            }, 500);
        }
    });
}
