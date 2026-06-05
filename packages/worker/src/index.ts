import pg from 'pg';
import { processWebhooks } from './webhook.ts';
import { processAuditEvents } from './audit.ts';
import { shouldRun } from './scheduler.ts';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://keel:keel_dev@localhost:5432/keel_master';
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3002', 10);

// ─── PostgreSQL pool ──────────────────────────────────

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });

// ─── Scheduler state ──────────────────────────────────

interface ScheduledJob {
  id: string;
  cron: string;
  handler: string;
  project?: string;
  data?: Record<string, unknown>;
  lastRun: number; // timestamp
}

const scheduledJobs = new Map<string, ScheduledJob>();

/**
 * Register a scheduled job.
 */
export function scheduleJob(
  id: string,
  cron: string,
  handler: string,
  project?: string,
  data?: Record<string, unknown>,
): void {
  scheduledJobs.set(id, {
    id,
    cron,
    handler,
    project,
    data,
    lastRun: 0,
  });
}

/**
 * Run the scheduler tick — check all registered jobs.
 */
async function runScheduler(): Promise<number> {
  let triggered = 0;
  const now = new Date();
  const nowMinute = Math.floor(now.getTime() / 60000); // truncate to minute

  for (const job of scheduledJobs.values()) {
    try {
      if (shouldRun(job.cron, now) && job.lastRun < nowMinute * 60000) {
        console.log(`🕐 Scheduler: triggering ${job.handler} (${job.cron})`);

        // Execute the handler function
        await executeHandler(job.handler, {
          type: 'scheduled',
          data: job.data || {},
          cron: job.cron,
          project: job.project,
          fired_at: now.toISOString(),
        });

        job.lastRun = Date.now();
        triggered++;
      }
    } catch (err) {
      console.error(
        `  ✗ Scheduler ${job.id} error:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return triggered;
}

/**
 * Execute a named handler function.
 */
async function executeHandler(
  handler: string,
  payload: Record<string, unknown>,
): Promise<void> {
  switch (handler) {
    case 'cleanup_expired_tokens': {
      // Clean up expired refresh tokens
      const { rowCount } = await pool.query(
        'DELETE FROM refresh_tokens WHERE expires_at < now()',
      );
      console.log(`  ✓ Cleaned up ${rowCount} expired tokens`);
      break;
    }
    case 'cleanup_expired_states': {
      // Clean up expired OAuth states
      const { rowCount } = await pool.query(
        "DELETE FROM oauth_states WHERE created_at < now() - interval '10 minutes'",
      );
      console.log(`  ✓ Cleaned up ${rowCount} expired OAuth states`);
      break;
    }
    case 'health_check': {
      // Simple health check ping
      await pool.query('SELECT 1');
      console.log('  ✓ Health check: DB connection OK');
      break;
    }
    case 'log': {
      console.log(`  📝 [scheduled:${handler}]:`, payload.data);
      break;
    }
    default:
      console.warn(`  ⚠ Unknown handler: ${handler}`);
  }
}

// ─── Main loop ────────────────────────────────────────

let running = true;
let tickCount = 0;

async function tick(): Promise<void> {
  tickCount++;
  const startTime = Date.now();

  try {
    // 1. Process webhooks
    const webhooksProcessed = await processWebhooks(pool);
    if (webhooksProcessed > 0) {
      console.log(`📨 Processed ${webhooksProcessed} webhook(s) on tick #${tickCount}`);
    }

    // 2. Process audit events
    const auditProcessed = await processAuditEvents(pool);
    if (auditProcessed > 0) {
      console.log(`📋 Processed ${auditProcessed} audit event(s) on tick #${tickCount}`);
    }

    // 3. Run scheduler (check every tick = every 5s)
    const scheduledTriggered = await runScheduler();
    if (scheduledTriggered > 0) {
      console.log(`🕐 Triggered ${scheduledTriggered} scheduled job(s) on tick #${tickCount}`);
    }

    const elapsed = Date.now() - startTime;
    if (tickCount % 12 === 0) { // log every ~60s
      console.log(
        `⏱️  Tick #${tickCount} completed in ${elapsed}ms (webhooks=${webhooksProcessed}, audit=${auditProcessed}, scheduled=${scheduledTriggered})`,
      );
    }
  } catch (err) {
    console.error(
      `❌ Tick #${tickCount} error:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (running) {
    setTimeout(tick, 5000); // run every 5 seconds
  }
}

// ─── Health HTTP server ───────────────────────────────

const healthServer = Bun.serve({
  port: HEALTH_PORT,
  fetch(req) {
    const url = new URL(req.url);

    const healthData = {
      status: running ? 'ok' : 'shutting_down',
      uptime: process.uptime(),
      tick_count: tickCount,
      scheduled_jobs: scheduledJobs.size,
      db_connected: true,
      timestamp: new Date().toISOString(),
    };

    if (url.pathname === '/health') {
      return new Response(JSON.stringify(healthData), {
        status: running ? 200 : 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/health/db') {
      // Check DB connectivity
      pool.query('SELECT 1')
        .then(() => {
          // Response already sent below if async
        })
        .catch(() => {
          healthData.db_connected = false;
          healthData.status = 'degraded';
        });

      return new Response(JSON.stringify(healthData), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Keel Worker', {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
});

// ─── Start ────────────────────────────────────────────

console.log(`⚙️  Keel Worker v0.2 started`);

// Register default scheduled jobs
scheduleJob('cleanup-tokens', '0 * * * *', 'cleanup_expired_tokens');
scheduleJob('cleanup-states', '*/10 * * * *', 'cleanup_expired_states');
scheduleJob('health-check', '*/5 * * * *', 'health_check');

// Connect to DB
try {
  await pool.query('SELECT 1');
  console.log('📊 DB connection established');
} catch (err) {
  console.error('Failed to connect to DB:', err);
  process.exit(1);
}

console.log(`❤️  Health server on http://0.0.0.0:${HEALTH_PORT}`);

// Start the main loop
setTimeout(tick, 1000);

// ─── Graceful shutdown ────────────────────────────────

const shutdown = async () => {
  console.log('\nShutting down worker...');
  running = false;
  await pool.end();
  healthServer.stop();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
