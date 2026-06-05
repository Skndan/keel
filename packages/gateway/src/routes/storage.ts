import type { FastifyInstance } from 'fastify';
import { createHash, createHmac } from 'node:crypto';
import { masterPool } from '../db.ts';
import { authMiddleware } from '../auth/middleware.ts';
import { decryptOrNull } from '../auth/encryption.ts';
import { nanoid } from 'nanoid';
import type { ProjectR2Config } from '@keel/types';

// AWS Signature V4 for R2 presigned URLs
// R2 uses the S3-compatible API

interface PresignedOptions {
  bucket: string;
  key: string;
  method: string;
  expiresIn: number;
  contentType?: string;
  endpoint: string; // e.g. https://<accountId>.r2.cloudflarestorage.com
  accessKeyId: string;
  secretAccessKey: string;
}

function generateR2PresignedUrl(options: PresignedOptions): string {
  const { accessKeyId, secretAccessKey, endpoint } = options;

  const region = 'auto';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const expires = options.expiresIn;

  const hostname = new URL(endpoint).hostname;
  const canonicalUri = `/${options.bucket}/${options.key}`;

  const queryParams = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  });

  if (options.contentType) {
    queryParams.set('Content-Type', options.contentType);
  }

  const canonicalQuerystring = queryParams.toString();

  const canonicalRequest = [
    options.method,
    canonicalUri,
    canonicalQuerystring,
    `host:${hostname}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const kDate = createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  queryParams.set('X-Amz-Signature', signature);

  return `https://${hostname}${canonicalUri}?${queryParams.toString()}`;
}

/**
 * Fetch and decrypt per-project R2 configuration.
 */
async function getProjectR2Config(slug: string, accountId: string): Promise<ProjectR2Config | null> {
  const { rows } = await masterPool.query(
    `SELECT r2_access_key_id, r2_secret_access_key, r2_bucket, r2_endpoint, r2_public_url
     FROM projects WHERE slug = $1 AND account_id = $2`,
    [slug, accountId],
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    accessKeyId: decryptOrNull(row.r2_access_key_id) || '',
    secretAccessKey: decryptOrNull(row.r2_secret_access_key) || '',
    bucket: decryptOrNull(row.r2_bucket) || '',
    endpoint: decryptOrNull(row.r2_endpoint),
    publicUrl: decryptOrNull(row.r2_public_url),
  };
}

export async function registerStorageRoutes(app: FastifyInstance): Promise<void> {
  // ─── POST /v1/project/:slug/storage/upload-url ───────────
  app.post(
    '/v1/project/:slug/storage/upload-url',
    { preHandler: [authMiddleware] },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const { filename, content_type } = req.body as {
        filename?: string;
        content_type?: string;
      };

      if (!filename) {
        return reply.status(400).send({
          error: { code: 'BAD_REQUEST', message: 'filename is required' },
        });
      }

      // Get per-project R2 config
      const r2Config = await getProjectR2Config(slug, req.accountId);
      if (!r2Config) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }

      if (!r2Config.accessKeyId || !r2Config.secretAccessKey || !r2Config.bucket) {
        return reply.status(400).send({
          error: { code: 'STORAGE_NOT_CONFIGURED', message: 'R2 storage not configured for this project' },
        });
      }

      const storageKey = `${slug}/${nanoid(12)}/${filename}`;

      try {
        const uploadUrl = generateR2PresignedUrl({
          bucket: r2Config.bucket,
          key: storageKey,
          method: 'PUT',
          expiresIn: 600, // 10 minutes
          contentType: content_type || 'application/octet-stream',
          endpoint: r2Config.endpoint || `https://${r2Config.accessKeyId}.r2.cloudflarestorage.com`,
          accessKeyId: r2Config.accessKeyId,
          secretAccessKey: r2Config.secretAccessKey,
        });

        return reply.send({
          data: {
            upload_url: uploadUrl,
            key: storageKey,
            headers: content_type ? { 'Content-Type': content_type } : {},
            expires_in: 600,
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to generate upload URL';
        return reply.status(500).send({
          error: { code: 'STORAGE_ERROR', message },
        });
      }
    },
  );

  // ─── GET /v1/project/:slug/storage/download-url ──────────
  app.get(
    '/v1/project/:slug/storage/download-url',
    { preHandler: [authMiddleware] },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const { key } = req.query as { key?: string };

      if (!key) {
        return reply.status(400).send({
          error: { code: 'BAD_REQUEST', message: 'key query parameter is required' },
        });
      }

      // Get per-project R2 config
      const r2Config = await getProjectR2Config(slug, req.accountId);
      if (!r2Config) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }

      if (!r2Config.accessKeyId || !r2Config.secretAccessKey || !r2Config.bucket) {
        return reply.status(400).send({
          error: { code: 'STORAGE_NOT_CONFIGURED', message: 'R2 storage not configured for this project' },
        });
      }

      try {
        const downloadUrl = generateR2PresignedUrl({
          bucket: r2Config.bucket,
          key,
          method: 'GET',
          expiresIn: 600,
          endpoint: r2Config.endpoint || `https://${r2Config.accessKeyId}.r2.cloudflarestorage.com`,
          accessKeyId: r2Config.accessKeyId,
          secretAccessKey: r2Config.secretAccessKey,
        });

        return reply.send({
          data: {
            download_url: downloadUrl,
            expires_in: 600,
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to generate download URL';
        return reply.status(500).send({
          error: { code: 'STORAGE_ERROR', message },
        });
      }
    },
  );
}
