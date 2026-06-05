import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface MigrationRunnerOptions {
  /** Connection string for the target database */
  connectionString: string;
  /** Directory containing .sql migration files */
  migrationsDir?: string;
  /** Table name for tracking applied migrations */
  trackingTable?: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  errors: { name: string; error: string }[];
}

/**
 * Run SQL migrations against a PostgreSQL database.
 * Reads .sql files from the migrations directory, applies them in order,
 * and tracks applied migrations in a tracking table.
 */
export async function runMigrations(options: MigrationRunnerOptions): Promise<MigrationResult> {
  const {
    connectionString,
    migrationsDir = join(__dirname, '..', 'migrations'),
    trackingTable = '_keel_migrations',
  } = options;

  const pool = new pg.Pool({ connectionString, max: 1 });
  const result: MigrationResult = { applied: [], skipped: [], errors: [] };

  try {
    // Ensure tracking table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${trackingTable} (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Get already-applied migrations
    const { rows: applied } = await pool.query(
      `SELECT name FROM ${trackingTable} ORDER BY id`,
    );

    const appliedSet = new Set(applied.map((r) => r.name));

    // Read migration files in order
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found in', migrationsDir);
      return result;
    }

    for (const file of files) {
      if (appliedSet.has(file)) {
        result.skipped.push(file);
        continue;
      }

      const sql = readFileSync(join(migrationsDir, file), 'utf-8');

      try {
        await pool.query('BEGIN');
        await pool.query(sql);
        await pool.query(
          `INSERT INTO ${trackingTable} (name) VALUES ($1)`,
          [file],
        );
        await pool.query('COMMIT');
        result.applied.push(file);
        console.log(`  ✓ ${file}`);
      } catch (err: unknown) {
        await pool.query('ROLLBACK');
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ name: file, error: msg });
        console.error(`  ✗ ${file}: ${msg}`);
        // Stop on first error to avoid cascading issues
        break;
      }
    }

    console.log(
      `\nMigrations: ${result.applied.length} applied, ${result.skipped.length} skipped, ${result.errors.length} errors`,
    );
  } finally {
    await pool.end();
  }

  return result;
}
