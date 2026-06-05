import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from './jwt.ts';

/**
 * Auth middleware: verifies JWT from Authorization header.
 * Attaches `accountId` to the request for downstream handlers.
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' },
    });
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken(token);

    if (payload.type !== 'access') {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid token type' },
      });
    }

    // Attach account_id to request for downstream use
    (request as FastifyRequest & { accountId: string }).accountId = payload.sub;
  } catch {
    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
    });
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    accountId: string;
  }
}
