import pg from 'pg';

/**
 * Audit consumer: reads from pgmq audit queue and writes to per-project audit_logs tables.
 * Uses the master database to resolve project DB connections.
 */

const BATCH_SIZE = 20;
const VT_SECONDS = 120;

export interface AuditEvent {
  project_slug: string;
  table_name: string;
  record_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  old_data: unknown | null;
  new_data: unknown | null;
  changed_by: string | null;
  timestamp: string;
}

/**
 * Process audit events from the queue.
 * Writes them to the per-project audit_logs table.
 */
export async function processAuditEvents(pool: pg.Pool): Promise<number> {
  let processed = 0;

  try {
    // Ensure audit queue exists
    await pool.query(`
      SELECT pgmq.create('keel_audit')
      WHERE NOT EXISTS (
        SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'keel_audit'
      )
    `);

    const { rows } = await pool.query(
      `SELECT * FROM pgmq.read('keel_audit', $1, $2)`,
      [BATCH_SIZE, VT_SECONDS],
    );

    if (rows.length === 0) return 0;

    for (const row of rows) {
      try {
        const event: AuditEvent =
          typeof row.message === 'string'
            ? JSON.parse(row.message)
            : row.message;

        await writeAuditLog(pool, event, row.msg_id);
        processed++;
      } catch (err) {
        console.error(
          `  ✗ Audit msg_id=${row.msg_id} failed:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  } catch (err) {
    console.error(
      'Audit poll error:',
      err instanceof Error ? err.message : String(err),
    );
  }

  return processed;
}

/**
 * Write a single audit event to the project's audit_logs table.
 */
async function writeAuditLog(
  masterPool: pg.Pool,
  event: AuditEvent,
  msgId: number,
): Promise<void> {
  const { project_slug } = event;
  if (!project_slug) {
    // Invalid event, archive
    await masterPool.query(`SELECT pgmq.archive('keel_audit', $1)`, [msgId]);
    return;
  }

  try {
    // Ensure audit_logs table exists in project DB
    await masterPool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id            BIGSERIAL PRIMARY KEY,
        project_slug  TEXT NOT NULL,
        table_name    TEXT NOT NULL,
        record_id     TEXT,
        action        TEXT NOT NULL,
        old_data      JSONB,
        new_data      JSONB,
        changed_by    TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_audit_logs_project ON audit_logs (project_slug);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs (project_slug, table_name);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at);
    `);

    // Insert audit record
    await masterPool.query(
      `INSERT INTO audit_logs
         (project_slug, table_name, record_id, action, old_data, new_data, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        project_slug,
        event.table_name,
        event.record_id || null,
        event.action,
        event.old_data ? JSON.stringify(event.old_data) : null,
        event.new_data ? JSON.stringify(event.new_data) : null,
        event.changed_by || null,
      ],
    );

    // Archive the message
    await masterPool.query(`SELECT pgmq.archive('keel_audit', $1)`, [msgId]);

    console.log(
      `  ✓ Audit: ${event.action} on ${project_slug}.${event.table_name} (msg_id=${msgId})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ Audit write failed for ${project_slug}: ${message}`);
    throw err; // Will retry after VT expires
  }
}

/**
 * Enqueue an audit event.
 */
export async function enqueueAuditEvent(
  pool: pg.Pool,
  event: AuditEvent,
): Promise<void> {
  await pool.query(`SELECT pgmq.send('keel_audit', $1)`, [
    JSON.stringify(event),
  ]);
}
