import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import Fastify from 'fastify';
import { registerHealthRoutes } from '../routes/health.ts';
import { registerProjectRoutes } from '../routes/projects.ts';
import { registerQueryRoutes } from '../routes/db.ts';
import { registerStorageRoutes } from '../routes/storage.ts';
import { authMiddleware } from '../auth/middleware.ts';
import { createAccessToken } from '../auth/jwt.ts';

// Set test env vars
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long!!';
process.env.BASE_URL = 'http://localhost:3000';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://keel:keel_dev@localhost:5432/keel_master';
process.env.R2_ACCOUNT_ID = '';
process.env.R2_ACCESS_KEY_ID = '';
process.env.R2_SECRET_ACCESS_KEY = '';
process.env.R2_BUCKET = 'test-bucket';
process.env.R2_PUBLIC_URL = '';

describe('Gateway Routes', () => {
  const app = Fastify({ logger: false });

  beforeAll(async () => {
    await registerHealthRoutes(app);
    await registerProjectRoutes(app);
    await registerQueryRoutes(app);
    await registerStorageRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /v1/health', () => {
    it('returns health status with database check', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/health',
      });

      expect(res.statusCode).toBeOneOf([200, 503]);
      const body = JSON.parse(res.body);
      expect(body.data).toBeDefined();
      expect(body.data.status).toBeDefined();
      expect(body.data.version).toBe('0.1.0');
      expect(body.data.checks).toBeDefined();
      expect(body.data.checks.database).toBeDefined();
    });
  });

  describe('POST /v1/projects', () => {
    it('returns 401 without auth header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/projects',
        body: { name: 'Test Project' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when name is missing', async () => {
      const token = await createAccessToken('test-account-id');
      const res = await app.inject({
        method: 'POST',
        url: '/v1/projects',
        headers: { authorization: `Bearer ${token}` },
        body: {},
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('returns 400 when name is empty', async () => {
      const token = await createAccessToken('test-account-id');
      const res = await app.inject({
        method: 'POST',
        url: '/v1/projects',
        headers: { authorization: `Bearer ${token}` },
        body: { name: '' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /v1/projects', () => {
    it('returns 401 without auth header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/projects',
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('DELETE /v1/projects/:slug', () => {
    it('returns 401 without auth header', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/projects/test-slug',
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /v1/project/:slug/db/query', () => {
    it('returns 401 without auth header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/project/test-slug/db/query',
        body: { query: 'SELECT 1' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 404 for non-existent project (or 500 if DB unavailable)', async () => {
      const token = await createAccessToken('test-account-id');
      const res = await app.inject({
        method: 'POST',
        url: '/v1/project/nonexistent/db/query',
        headers: { authorization: `Bearer ${token}` },
        body: { query: 'SELECT 1' },
      });

      // 404 when DB available and project not found, 500 when DB unavailable
      expect([404, 500]).toContain(res.statusCode);
      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
    });
  });

  describe('POST /v1/project/:slug/storage/upload-url', () => {
    it('returns 401 without auth header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/project/test-slug/storage/upload-url',
        body: { filename: 'test.txt' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when filename is missing', async () => {
      const token = await createAccessToken('test-account-id');
      const res = await app.inject({
        method: 'POST',
        url: '/v1/project/test-slug/storage/upload-url',
        headers: { authorization: `Bearer ${token}` },
        body: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /v1/project/:slug/storage/download-url', () => {
    it('returns 401 without auth header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/project/test-slug/storage/download-url?key=test-key',
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when key is missing', async () => {
      const token = await createAccessToken('test-account-id');
      const res = await app.inject({
        method: 'GET',
        url: '/v1/project/test-slug/storage/download-url',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
