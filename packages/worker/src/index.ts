import pg from 'pg';
import type { JobPayload } from '@keel/types';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://keel:keel_dev@localhost:5432/keel_master';
const POLL_INTERVAL_MS = 5000; // 5 seconds
const BATCH_SIZE = 10;

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });

/**
 * Registered job handlers.
 */
const handlers = new Map<string, (job: JobPayload) => Promise<void>>();

export function registerHandler(type: string, handler: (job: JobPayload) => Promise<void>): void {
  handlers.set(type, handler);
}

/**
 * Poll pgmq for jobs and dispatch to handlers.
 */
async function pollQueue(): Promise<void> {
  try {
    // Ensure the queue exists
    await pool.query(`
      SELECT pgmq.create('keel_jobs')
      WHERE NOT EXISTS (
        SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'keel_jobs'
      )
    `);

    // Read batch of messages
    const { rows } = await pool.query(
      `SELECT * FROM pgmq.read('keel_jobs', $1, $2)`,
      [BATCH_SIZE, 60], // vt = 60 seconds visibility timeout
    );

    if (rows.length === 0) return;

    console.log(`📦 Processing ${rows.length} job(s)`);

    for (const row of rows) {
      const msgId = row.msg_id;
      let payload: JobPayload;

      try {
        payload = typeof row.message === 'string' ? JSON.parse(row.message) : row.message;
      } catch {
        console.error(`  ✗ Invalid message format for msg_id=${msgId}`);
        continue;
      }

      const handler = handlers.get(payload.type);

      if (!handler) {
        console.warn(`  ⚠ No handler for job type: ${payload.type}`);
        await pool.query(`SELECT pgmq.archive('keel_jobs', $1)`, [msgId]);
        continue;
      }

      try {
        await handler(payload);
        await pool.query(`SELECT pgmq.archive('keel_jobs', $1)`, [msgId]);
        console.log(`  ✓ ${payload.type} (msg_id=${msgId})`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${payload.type} failed: ${message}`);
        // Don't archive on failure — it will be retried after VT expires
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Poll error:', message);
  }
}

/**
 * Send a job to the queue.
 */
export async function enqueue(job: JobPayload): Promise<void> {
  await pool.query(
    `SELECT pgmq.send('keel_jobs', $1)`,
    [JSON.stringify(job)],
  );
}

// ─── Default handlers ───────────────────────────────────

registerHandler('log', async (job) => {
  console.log(`📝 [${job.project_id || 'system'}]:`, job.data);
});

registerHandler('webhook', async (job) => {
  const { url, method = 'POST', body, headers } = job.data;
  if (!url) return;
  console.log(`🌐 Webhook ${method} ${url}`);
  await fetch(url as string, {
    method: method as string,
    headers: headers as Record<string, string> || { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
});

// ─── Start ──────────────────────────────────────────────

console.log('⚙️  Keel Worker started');

async function run(): Promise<void> {
  await pollQueue();
  setTimeout(run, POLL_INTERVAL_MS);
}

run().catch(console.error);

// ─── Graceful shutdown ──────────────────────────────────
const shutdown = async () => {
  console.log('\nShutting down worker...');
  await pool.end();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
