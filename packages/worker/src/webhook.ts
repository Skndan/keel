import pg from 'pg';
import { withRetry } from './retry.ts';
import { signPayload } from './signature.ts';

export interface WebhookJob {
  msg_id: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  signing_secret: string | null;
  attempt: number;
  max_attempts: number;
}

const BATCH_SIZE = 10;
const VT_SECONDS = 120; // visibility timeout

/**
 * Poll the webhook queue and deliver pending webhooks.
 * Uses pgmq with SKIP LOCKED semantics via vt (visibility timeout).
 */
export async function processWebhooks(pool: pg.Pool): Promise<number> {
  let processed = 0;

  try {
    // Ensure webhook queue exists
    await pool.query(`
      SELECT pgmq.create('keel_webhooks')
      WHERE NOT EXISTS (
        SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'keel_webhooks'
      )
    `);

    // Read batch with visibility timeout (acts like SKIP LOCKED)
    const { rows } = await pool.query(
      `SELECT * FROM pgmq.read('keel_webhooks', $1, $2)`,
      [BATCH_SIZE, VT_SECONDS],
    );

    if (rows.length === 0) return 0;

    for (const row of rows) {
      try {
        const message: WebhookJob =
          typeof row.message === 'string'
            ? JSON.parse(row.message)
            : row.message;

        await deliverWebhook(message, row.msg_id, pool);
        processed++;
      } catch (err) {
        console.error(
          `  ✗ Webhook msg_id=${row.msg_id} failed:`,
          err instanceof Error ? err.message : String(err),
        );
        // Don't archive on failure — it becomes visible again after VT expires
      }
    }
  } catch (err) {
    console.error(
      'Webhook poll error:',
      err instanceof Error ? err.message : String(err),
    );
  }

  return processed;
}

/**
 * Deliver a single webhook with retry and HMAC signing.
 */
async function deliverWebhook(
  job: WebhookJob,
  msgId: number,
  pool: pg.Pool,
): Promise<void> {
  const {
    url,
    method = 'POST',
    headers = {},
    body,
    signing_secret,
    attempt = 0,
    max_attempts = 5,
  } = job;

  if (!url) {
    // Archive invalid jobs immediately
    await pool.query(`SELECT pgmq.archive('keel_webhooks', $1)`, [msgId]);
    return;
  }

  try {
    await withRetry(
      async () => {
        const payload = typeof body === 'string' ? body : JSON.stringify(body);
        const requestHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'Keel-Webhook/0.2',
          'X-Keel-Webhook-Id': `wh_${msgId}`,
          'X-Keel-Webhook-Attempt': String(attempt + 1),
          ...headers,
        };

        // Add HMAC signature if secret is provided
        if (signing_secret) {
          requestHeaders['X-Keel-Signature'] = await signPayload(
            payload,
            signing_secret,
          );
        }

        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: method !== 'GET' && method !== 'HEAD' ? payload : undefined,
          signal: AbortSignal.timeout(30_000), // 30s timeout
        });

        if (!response.ok) {
          throw new Error(
            `Webhook delivery failed: ${response.status} ${response.statusText}`,
          );
        }

        console.log(
          `  ✓ Webhook ${method} ${url} → ${response.status} (msg_id=${msgId})`,
        );
      },
      {
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        maxAttempts: max_attempts - attempt,
      },
      (retryAttempt, delayMs, error) => {
        console.warn(
          `  ⚠ Webhook msg_id=${msgId} attempt ${retryAttempt}: ${error.message}. Retrying in ${delayMs}ms`,
        );
      },
    );

    // Success — archive the message
    await pool.query(`SELECT pgmq.archive('keel_webhooks', $1)`, [msgId]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Check if we've exhausted all attempts
    const nextAttempt = attempt + 1;
    if (nextAttempt >= max_attempts) {
      console.error(
        `  ✗ Webhook msg_id=${msgId} exhausted all ${max_attempts} attempts. Archiving as dead.`,
      );
      await pool.query(`SELECT pgmq.archive('keel_webhooks', $1)`, [msgId]);

      // Optionally send to dead letter queue
      try {
        await pool.query(`
          SELECT pgmq.create('keel_webhooks_dlq')
          WHERE NOT EXISTS (
            SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'keel_webhooks_dlq'
          )
        `);
        await pool.query(
          `SELECT pgmq.send('keel_webhooks_dlq', $1)`,
          [
            JSON.stringify({
              original_msg_id: msgId,
              error: message,
              failed_at: new Date().toISOString(),
              job,
            }),
          ],
        );
      } catch {
        // DLQ is best-effort
      }
    } else {
      // Re-enqueue with incremented attempt counter
      // pgmq.read with vt will make it visible again; we set vt shorter
      // for jobs that should be retried
      console.warn(
        `  ⚠ Webhook msg_id=${msgId} will retry (attempt ${nextAttempt}/${max_attempts})`,
      );
      throw err; // Rethrow to keep it in pending state (vt will expire)
    }
  }
}

/**
 * Send a webhook job to the queue.
 */
export async function enqueueWebhook(
  pool: pg.Pool,
  job: Omit<WebhookJob, 'msg_id' | 'attempt'>,
): Promise<void> {
  await pool.query(`SELECT pgmq.send('keel_webhooks', $1)`, [
    JSON.stringify({ ...job, attempt: 0 }),
  ]);
}
