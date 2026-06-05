import type { FastifyInstance } from 'fastify';
import { masterPool } from '../db.ts';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/health', async (_req, reply) => {
    const checks: Record<string, { status: string; latency_ms?: number }> = {};

    // Check database
    try {
      const start = Date.now();
      await masterPool.query('SELECT 1');
      checks.database = { status: 'ok', latency_ms: Date.now() - start };
    } catch {
      checks.database = { status: 'error' };
    }

    const allOk = Object.values(checks).every((c) => c.status === 'ok');

    return reply.status(allOk ? 200 : 503).send({
      data: {
        status: allOk ? 'healthy' : 'degraded',
        version: '0.1.0',
        checks,
      },
    });
  });
}
