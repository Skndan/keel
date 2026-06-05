import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { masterPool, getProjectPool, removeProjectPool } from '../db.ts';
import { authMiddleware } from '../auth/middleware.ts';
import { encryptOrNull } from '../auth/encryption.ts';
import { nanoid } from 'nanoid';
import { runMigrations } from '@keel/db/src/runner.ts';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { CreateProjectRequest } from '@keel/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, '..', '..', '..', 'db', 'templates');

/**
 * Generate a URL-safe slug from a project name.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

/**
 * Generate a raw API key (shown once to user, stored hashed).
 */
function generateApiKey(slug: string): { raw: string; hash: string } {
  const raw = `keel_${slug}_${nanoid(32)}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

/**
 * Generate a secure database password.
 */
function generateDbPassword(): string {
  return nanoid(32);
}

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  // ─── POST /v1/projects — Create a new project ────────────
  app.post('/v1/projects', { preHandler: [authMiddleware] }, async (req, reply) => {
    const { name, ...opts } = req.body as CreateProjectRequest;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Project name is required' },
      });
    }

    const slug = slugify(name);
    if (slug.length < 3) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Project name too short' },
      });
    }

    const dbName = `keel_p_${slug}`;
    const dbUser = `keel_u_${slug}`;
    const dbPassword = generateDbPassword();
    const { raw: apiKey, hash: apiKeyHash } = generateApiKey(slug);

    const client = await masterPool.connect();

    try {
      await client.query('BEGIN');

      // Check slug uniqueness
      const { rows: existing } = await client.query(
        'SELECT id FROM projects WHERE slug = $1 FOR UPDATE',
        [slug],
      );
      if (existing.length > 0) {
        await client.query('ROLLBACK');
        return reply.status(409).send({
          error: { code: 'CONFLICT', message: 'Project slug already exists' },
        });
      }

      // Create database
      await client.query(`CREATE DATABASE "${dbName}"`);
      await client.query(`CREATE USER "${dbUser}" WITH PASSWORD '${dbPassword}'`);
      await client.query(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${dbUser}"`);

      // Run template migration on the new database
      const templateUrl = new URL(
        `postgresql://keel:${encodeURIComponent(dbPassword)}@${
          new URL(process.env.DATABASE_URL || '').hostname || 'localhost'
        }:5432/${dbName}`,
      );

      await runMigrations({
        connectionString: `postgresql://keel:${dbPassword}@localhost:5432/${dbName}`,
        migrationsDir: TEMPLATE_DIR,
      });

      // Insert project record with optional OAuth + R2 configs (encrypted)
      const { rows: projects } = await client.query(
        `INSERT INTO projects (
           account_id, name, slug, db_name, db_user, api_key_hash,
           google_client_id, google_client_secret, github_client_id, github_client_secret,
           r2_access_key_id, r2_secret_access_key, r2_bucket, r2_endpoint, r2_public_url
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id, name, slug, created_at`,
        [
          req.accountId, name.trim(), slug, dbName, dbUser, apiKeyHash,
          encryptOrNull(opts.google_client_id),
          encryptOrNull(opts.google_client_secret),
          encryptOrNull(opts.github_client_id),
          encryptOrNull(opts.github_client_secret),
          encryptOrNull(opts.r2_access_key_id),
          encryptOrNull(opts.r2_secret_access_key),
          encryptOrNull(opts.r2_bucket),
          encryptOrNull(opts.r2_endpoint),
          encryptOrNull(opts.r2_public_url),
        ],
      );

      await client.query('COMMIT');

      return reply.status(201).send({
        data: {
          ...projects[0],
          api_key: apiKey,
          db_name: dbName,
          db_user: dbUser,
          db_password: dbPassword,
        },
      });
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const message = err instanceof Error ? err.message : 'Project creation failed';
      return reply.status(500).send({
        error: { code: 'PROVISION_FAILED', message },
      });
    } finally {
      client.release();
    }
  });

  // ─── GET /v1/projects — List account's projects ──────────
  app.get('/v1/projects', { preHandler: [authMiddleware] }, async (req, reply) => {
    const { rows } = await masterPool.query(
      `SELECT id, name, slug, created_at FROM projects
       WHERE account_id = $1
       ORDER BY created_at DESC`,
      [req.accountId],
    );

    return reply.send({ data: rows });
  });

  // ─── GET /v1/projects/:slug — Get project details ────────
  app.get('/v1/projects/:slug', { preHandler: [authMiddleware] }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const { rows } = await masterPool.query(
      `SELECT id, name, slug, created_at FROM projects
       WHERE slug = $1 AND account_id = $2`,
      [slug, req.accountId],
    );

    if (rows.length === 0) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Project not found' },
      });
    }

    return reply.send({ data: rows[0] });
  });

  // ─── PATCH /v1/projects/:slug — Update project settings ──
  app.patch('/v1/projects/:slug', { preHandler: [authMiddleware] }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const body = req.body as Record<string, string | undefined>;

    // Build SET clause from allowed config fields
    const allowedFields: Record<string, string> = {
      google_client_id: encryptOrNull(body.google_client_id),
      google_client_secret: encryptOrNull(body.google_client_secret),
      github_client_id: encryptOrNull(body.github_client_id),
      github_client_secret: encryptOrNull(body.github_client_secret),
      r2_access_key_id: encryptOrNull(body.r2_access_key_id),
      r2_secret_access_key: encryptOrNull(body.r2_secret_access_key),
      r2_bucket: encryptOrNull(body.r2_bucket),
      r2_endpoint: encryptOrNull(body.r2_endpoint),
      r2_public_url: encryptOrNull(body.r2_public_url),
    };

    const sets: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    for (const [key, val] of Object.entries(allowedFields)) {
      if (val !== undefined) {
        sets.push(`${key} = $${paramIdx}`);
        values.push(val);
        paramIdx++;
      }
    }

    if (sets.length === 0) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'No valid config fields provided' },
      });
    }

    sets.push(`updated_at = now()`);

    // Add slug and account_id as WHERE params
    values.push(slug, req.accountId);

    const { rowCount } = await masterPool.query(
      `UPDATE projects SET ${sets.join(', ')} WHERE slug = $${paramIdx} AND account_id = $${paramIdx + 1}`,
      values,
    );

    if (rowCount === 0) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Project not found' },
      });
    }

    return reply.send({ data: { slug, updated: true } });
  });

  // ─── DELETE /v1/projects/:slug — Delete project ──────────
  app.delete('/v1/projects/:slug', { preHandler: [authMiddleware] }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const client = await masterPool.connect();

    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT id, db_name FROM projects
         WHERE slug = $1 AND account_id = $2
         FOR UPDATE`,
        [slug, req.accountId],
      );

      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }

      const { db_name } = rows[0];

      // Remove project pool first
      await removeProjectPool(slug);

      // Drop the database (force disconnect other connections)
      await client.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [db_name],
      );
      await client.query(`DROP DATABASE IF EXISTS "${db_name}"`);

      // Remove project record
      await client.query('DELETE FROM projects WHERE slug = $1', [slug]);

      await client.query('COMMIT');

      return reply.status(204).send();
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const message = err instanceof Error ? err.message : 'Project deletion failed';
      return reply.status(500).send({
        error: { code: 'DELETE_FAILED', message },
      });
    } finally {
      client.release();
    }
  });
}

export { getProjectPool, removeProjectPool };
