import { WebSocketServer, WebSocket } from 'ws';
import pg from 'pg';
import { jwtVerify } from 'jose';
import { createServer } from 'node:http';

const PORT = parseInt(process.env.PORT || '3001', 10);
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://keel:keel_dev@localhost:5432/keel_master';
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-secret-change-in-production-min-32-chars!!',
);

// Channel -> Set of websockets
const channels = new Map<string, Set<WebSocket>>();
// WebSocket -> project slug
const wsProjects = new Map<WebSocket, string>();

// ─── HTTP server (required for ws upgrade) ──────────────
const server = createServer((_req, res) => {
  res.writeHead(200);
  res.end('Keel Realtime Server');
});

const wss = new WebSocketServer({ server });

// ─── Postgres LISTEN for pg_notify ──────────────────────
const pgPool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });

async function startListening(): Promise<void> {
  const client = await pgPool.connect();
  client.on('notification', (msg) => {
    if (!msg.channel || !msg.payload) return;

    // Broadcast to subscribed clients for this project
    const subscribers = channels.get(msg.channel);
    if (!subscribers) return;

    const message = JSON.stringify({
      type: 'data',
      channel: msg.channel,
      payload: JSON.parse(msg.payload),
    });

    for (const ws of subscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  });

  await client.query('LISTEN keel_change');
  console.log('📡 Listening for pg_notify on keel_change');

  // Also listen for project-specific channels (from master db)
  // We'll subscribe when clients connect

  client.on('error', (err) => {
    console.error('PG listener error:', err);
  });
}

// ─── WebSocket handler ──────────────────────────────────

wss.on('connection', async (ws, req) => {
  console.log('New WebSocket connection');

  // Extract JWT from query params (WebSocket upgrade doesn't have auth header)
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  let accountId: string | null = null;

  if (token) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET, {
        algorithms: ['HS256'],
      });
      accountId = payload.sub || null;
    } catch {
      console.log('Invalid JWT on WS connection');
    }
  }

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'subscribe': {
          if (!msg.channel || !msg.project) {
            ws.send(JSON.stringify({ type: 'error', payload: 'Missing channel or project' }));
            return;
          }

          const { channel: chan, project } = msg;

          // Validate that this channel belongs to the project
          if (!chan.startsWith(`${project}:`)) {
            ws.send(JSON.stringify({ type: 'error', payload: 'Invalid channel for project' }));
            return;
          }

          if (!channels.has(chan)) {
            channels.set(chan, new Set());
          }
          channels.get(chan)!.add(ws);
          wsProjects.set(ws, project);

          // LISTEN on a per-project channel
          try {
            await pgPool.query(`LISTEN "${chan}"`);
          } catch {
            // Channel may already be listened
          }

          ws.send(JSON.stringify({ type: 'subscribed', channel: chan }));
          break;
        }

        case 'unsubscribe': {
          const { channel: chan } = msg;
          const subs = channels.get(chan);
          if (subs) {
            subs.delete(ws);
            if (subs.size === 0) {
              channels.delete(chan);
            }
          }
          ws.send(JSON.stringify({ type: 'unsubscribed', channel: chan }));
          break;
        }

        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        }
      }
    } catch {
      ws.send(JSON.stringify({ type: 'error', payload: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    wsProjects.delete(ws);
    // Remove from all channel subscriptions
    for (const [, subs] of channels) {
      subs.delete(ws);
    }
    // Clean up empty channels
    for (const [chan, subs] of channels) {
      if (subs.size === 0) channels.delete(chan);
    }
  });

  ws.on('error', (err) => {
    console.error('WS error:', err);
  });
});

// ─── Start ──────────────────────────────────────────────

startListening().catch(console.error);

server.listen(PORT, () => {
  console.log(`🔌 Keel Realtime running on ws://0.0.0.0:${PORT}`);
});

// ─── Graceful shutdown ──────────────────────────────────
const shutdown = async () => {
  console.log('\nShutting down realtime server...');
  wss.close();
  server.close();
  await pgPool.end();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
