import type { FastifyInstance } from 'fastify';
import { masterPool, getProjectPool } from '../db.ts';
import { authMiddleware } from '../auth/middleware.ts';
import type { QueryRequest, QueryResponse } from '@keel/types';

export async function registerQueryRoutes(app: FastifyInstance): Promise<void> {
  // ─── POST /v1/project/:slug/db/query — Run SQL on project DB ─
  app.post(
    '/v1/project/:slug/db/query',
    { preHandler: [authMiddleware] },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const { query, params = [] } = req.body as QueryRequest;

      if (!query || typeof query !== 'string') {
        return reply.status(400).send({
          error: { code: 'BAD_REQUEST', message: 'Query string is required' },
        });
      }

      // Verify project ownership and get db_name
      const { rows: projects } = await masterPool.query(
        `SELECT db_name FROM projects WHERE slug = $1 AND account_id = $2`,
        [slug, req.accountId],
      );

      if (projects.length === 0) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }

      const { db_name } = projects[0];

      // Whitelist: only allow SELECT, INSERT, UPDATE, DELETE
      const normalized = query.trim().toUpperCase();
      const allowedOps = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH'];
      const isAllowed = allowedOps.some((op) => normalized.startsWith(op));

      if (!isAllowed) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'Only SELECT, INSERT, UPDATE, DELETE queries are allowed',
          },
        });
      }

      // Block DDL and dangerous operations
      const blocked = ['DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE'];
      const hasBlocked = blocked.some((kw) => normalized.includes(kw));
      if (hasBlocked) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'DDL operations are not allowed' },
        });
      }

      try {
        const pool = getProjectPool(slug, db_name);
        const result = await pool.query({
          text: query,
          values: params,
          rowMode: 'array',
        });

        const response: QueryResponse = {
          rows: result.rows,
          rowCount: result.rowCount ?? 0,
          fields: result.fields?.map((f) => ({
            name: f.name,
            dataTypeID: f.dataTypeID,
          })),
        };

        return reply.send({ data: response });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Query failed';
        return reply.status(400).send({
          error: { code: 'QUERY_ERROR', message },
        });
      }
    },
  );
}
