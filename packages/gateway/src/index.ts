import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.ts';
import { closeAllPools } from './db.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerProjectRoutes } from './routes/projects.ts';
import { registerQueryRoutes } from './routes/db.ts';
import { registerStorageRoutes } from './routes/storage.ts';
import { registerHealthRoutes } from './routes/health.ts';

const app = Fastify({
  logger: {
    level: config.nodeEnv === 'production' ? 'info' : 'debug',
  },
});

// ─── Plugins ────────────────────────────────────────────

await app.register(cors, {
  origin: config.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  errorResponseBuilder: (_req, ctx) => ({
    error: {
      code: 'RATE_LIMITED',
      message: `Too many requests. Retry after ${ctx.after}`,
    },
  }),
});

// ─── Error handler ──────────────────────────────────────

app.setErrorHandler((error, _req, reply) => {
  if (reply.sent) return;
  app.log.error(error);
  const statusCode = error.statusCode || 500;
  reply.status(statusCode).send({
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message || 'Internal server error',
    },
  });
});

// ─── Routes ─────────────────────────────────────────────

await registerHealthRoutes(app);
await registerAuthRoutes(app);
await registerProjectRoutes(app);
await registerQueryRoutes(app);
await registerStorageRoutes(app);

// ─── Admin routes ───────────────────────────────────────

// List all projects (admin only — placeholder for future admin auth)
app.get('/v1/admin/projects', async (_req, reply) => {
  const { rows } = await app.pg.query(
    `SELECT p.id, p.name, p.slug, p.db_name, p.account_id, a.email as owner_email, p.created_at
     FROM projects p
     JOIN accounts a ON a.id = p.account_id
     ORDER BY p.created_at DESC`,
  );
  return reply.send({ data: rows });
});

// ─── Metrics endpoint ───────────────────────────────────

app.get('/v1/metrics', async (_req, reply) => {
  const { rows: accountCount } = await app.pg.query('SELECT count(*) as count FROM accounts');
  const { rows: projectCount } = await app.pg.query('SELECT count(*) as count FROM projects');
  return reply.send({
    data: {
      accounts: parseInt(accountCount[0].count, 10),
      projects: parseInt(projectCount[0].count, 10),
    },
  });
});

// ─── Start server ───────────────────────────────────────

const start = async () => {
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`🚀 Keel Gateway running on http://0.0.0.0:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// ─── Graceful shutdown ──────────────────────────────────

const shutdown = async () => {
  console.log('\nShutting down gracefully...');
  await app.close();
  await closeAllPools();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();

export default app;
