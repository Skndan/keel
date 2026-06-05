#!/usr/bin/env bun
/**
 * Initialize the master database: run all migrations.
 * Usage: bun run packages/db/src/init.ts
 */
import { runMigrations } from './runner.ts';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://keel:keel_dev@localhost:5432/keel_master';

console.log('Running master DB migrations...\n');
const result = await runMigrations({ connectionString: DATABASE_URL });

if (result.errors.length > 0) {
  console.error('\nMigration failed!');
  process.exit(1);
}

console.log('\nMaster DB initialized successfully.');
