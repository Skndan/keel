import pg from 'pg';
import { config } from './config.ts';

// Master pool for keel_master database
const masterPool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

// Per-project pools (slug -> pool)
const projectPools = new Map<string, pg.Pool>();

/**
 * Get or create a per-project database pool.
 */
export function getProjectPool(slug: string, dbName: string): pg.Pool {
  const existing = projectPools.get(slug);
  if (existing) return existing;

  // Parse master URL and replace database name
  const url = new URL(config.databaseUrl);
  url.pathname = `/${dbName}`;

  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: 5,
  });

  projectPools.set(slug, pool);
  return pool;
}

/**
 * Remove and end a project pool.
 */
export async function removeProjectPool(slug: string): Promise<void> {
  const pool = projectPools.get(slug);
  if (pool) {
    await pool.end();
    projectPools.delete(slug);
  }
}

export { masterPool };

// Graceful shutdown helper
export async function closeAllPools(): Promise<void> {
  await masterPool.end();
  for (const [, pool] of projectPools) {
    await pool.end();
  }
  projectPools.clear();
}
