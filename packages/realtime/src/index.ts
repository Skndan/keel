import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { verifyJwt, verifyApiKey } from './auth.ts';
import { PgListenerManager } from './pg-listener.ts';
import {
  SubscriptionManager,
  evaluateFilter,
  type SubscriptionFilter,
} from './subscriptions.ts';
import { SequenceTracker } from './sequence.ts';

const PORT = parseInt(process.env.PORT || '3001', 10);
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://keel:keel_dev@localhost:5432/keel_master';

// ─── State ────────────────────────────────────────────────

const subs = new SubscriptionManager();
const seq = new SequenceTracker();
const pgListener = new PgListenerManager(DATABASE_URL);

// ws → authenticated context
const wsAuth = new Map<WebSocket, WsAuth>();

interface WsAuth {
  mode: 'account' | 'apikey';
  accountId?: string;
  projectId?: string;
  slug?: string;
}

// ─── HTTP server ──────────────────────────────────────────

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        subscriptions: subs.count,
        connections: subs.wsCount,
        sequence: seq.getCurrentSeq(),
      }),
    );
    return;
  }

  res.writeHead(200);
  res.end('Keel Realtime Server');
});

// ─── WebSocket server ─────────────────────────────────────

const wss = new WebSocketServer({ server });

wss.on('connection', async (ws, req) => {
  // Extract JWT or API key from query params
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const apiKey = url.searchParams.get('apikey');

  // Authenticate
  let auth: WsAuth | null = null;

  if (token) {
    const payload = await verifyJwt(token);
    if (payload) {
      auth = { mode: 'account', accountId: payload.sub };
    }
  }

  if (!auth && apiKey) {
    const projectInfo = await verifyApiKey(apiKey, pgListener['masterPool']);
    if (projectInfo) {
      auth = {
        mode: 'apikey',
        projectId: projectInfo.projectId,
        slug: projectInfo.slug,
      };
    }
  }

  if (!auth) {
    ws.send(JSON.stringify({ type: 'error', payload: 'Authentication required. Use ?token= or ?apikey=' }));
    ws.close(4001, 'Unauthorized');
    return;
  }

  wsAuth.set(ws, auth);
  console.log(`🔌 Client connected (${auth.mode})`);

  // ─── Message handler ──────────────────────────────────

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      await handleMessage(ws, msg);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', payload: 'Invalid message format' }));
    }
  });

  // ─── Close handler ────────────────────────────────────

  ws.on('close', () => {
    wsAuth.delete(ws);
    subs.unsubscribeAll(ws);
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });

  // Send welcome
  ws.send(
    JSON.stringify({
      type: 'system',
      payload: {
        message: 'Connected to Keel Realtime',
        protocol: 'v0.2',
        seq: seq.getCurrentSeq(),
      },
    }),
  );
});

// ─── Message handler ──────────────────────────────────────

async function handleMessage(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
  const auth = wsAuth.get(ws);
  if (!auth) return;

  switch (msg.type) {
    case 'subscribe':
      await handleSubscribe(ws, auth, msg);
      break;
    case 'unsubscribe':
      handleUnsubscribe(ws, msg);
      break;
    case 'replay':
      handleReplay(ws, msg);
      break;
    case 'resume':
      handleResume(ws, auth, msg);
      break;
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', seq: seq.getCurrentSeq() }));
      break;
    default:
      ws.send(JSON.stringify({ type: 'error', payload: `Unknown message type: ${msg.type}` }));
  }
}

// ─── Subscribe ────────────────────────────────────────────

async function handleSubscribe(
  ws: WebSocket,
  auth: WsAuth,
  msg: Record<string, unknown>,
): Promise<void> {
  const project = (msg.project as string) || auth.slug;
  const table = msg.table as string | undefined;
  const filter = msg.filter as SubscriptionFilter | undefined;

  if (!project) {
    ws.send(JSON.stringify({ type: 'error', payload: 'Missing project' }));
    return;
  }

  // Validate project access
  if (auth.mode === 'apikey' && auth.slug !== project) {
    ws.send(JSON.stringify({ type: 'error', payload: 'Access denied to this project' }));
    return;
  }

  const projectDb = `keel_p_${project}`;

  // Start listening on this project's database if not already
  await pgListener.subscribeProject(projectDb, 'keel_change');

  // Register callback for this project
  pgListener.onNotification(projectDb, 'keel_change', (channel, payload) => {
    broadcastChange(projectDb, project, channel, payload);
  });

  // Create subscription
  const sub = subs.subscribe(ws, project, projectDb, table || null, filter || null);

  ws.send(
    JSON.stringify({
      type: 'subscribed',
      subscription_id: sub.id,
      project,
      table: table || '*',
      filter: filter || null,
    }),
  );
}

// ─── Unsubscribe ──────────────────────────────────────────

function handleUnsubscribe(ws: WebSocket, msg: Record<string, unknown>): void {
  const subId = msg.subscription_id as string;
  if (!subId) {
    ws.send(JSON.stringify({ type: 'error', payload: 'Missing subscription_id' }));
    return;
  }

  const sub = subs.get(subId);
  if (!sub) {
    ws.send(JSON.stringify({ type: 'error', payload: 'Subscription not found' }));
    return;
  }

  subs.unsubscribe(ws, subId);
  ws.send(JSON.stringify({ type: 'unsubscribed', subscription_id: subId }));
}

// ─── Replay ───────────────────────────────────────────────

function handleReplay(ws: WebSocket, msg: Record<string, unknown>): void {
  const lastSeq = (msg.last_seq as number) || 0;

  if (!seq.canReplay(lastSeq)) {
    ws.send(
      JSON.stringify({
        type: 'system',
        payload: {
          message: 'Cannot replay from this sequence — buffer too old. Full resync needed.',
          current_seq: seq.getCurrentSeq(),
        },
      }),
    );
    return;
  }

  const events = seq.replay(lastSeq);
  for (const event of events) {
    ws.send(JSON.stringify({ type: 'data', ...event }));
  }

  ws.send(
    JSON.stringify({
      type: 'replay_complete',
      payload: {
        events: events.length,
        from_seq: lastSeq,
        to_seq: seq.getCurrentSeq(),
      },
    }),
  );
}

// ─── Resume ───────────────────────────────────────────────

function handleResume(ws: WebSocket, auth: WsAuth, msg: Record<string, unknown>): void {
  const subscriptions = (msg.subscriptions as Array<{
    subscription_id: string;
    last_seq: number;
  }>) || [];

  if (subscriptions.length === 0) {
    ws.send(JSON.stringify({ type: 'error', payload: 'No subscriptions provided for resume' }));
    return;
  }

  const results: Array<{
    subscription_id: string;
    ok: boolean;
    replayed: number;
    current_seq: number;
  }> = [];

  for (const s of subscriptions) {
    const sub = subs.get(s.subscription_id);
    if (!sub) {
      results.push({
        subscription_id: s.subscription_id,
        ok: false,
        replayed: 0,
        current_seq: seq.getCurrentSeq(),
      });
      continue;
    }

    if (!seq.canReplay(s.last_seq)) {
      results.push({
        subscription_id: s.subscription_id,
        ok: false,
        replayed: 0,
        current_seq: seq.getCurrentSeq(),
      });
      continue;
    }

    const events = seq.replay(s.last_seq);
    for (const event of events) {
      // Only send events matching this subscription
      if (
        event.project === sub.project &&
        (!sub.table || sub.table === event.table)
      ) {
        ws.send(JSON.stringify({ type: 'data', ...event }));
      }
    }

    subs.updateLastSeq(s.subscription_id, seq.getCurrentSeq());

    results.push({
      subscription_id: s.subscription_id,
      ok: true,
      replayed: events.filter(
        (e) =>
          e.project === sub.project &&
          (!sub.table || sub.table === event.table),
      ).length,
      current_seq: seq.getCurrentSeq(),
    });
  }

  ws.send(
    JSON.stringify({
      type: 'resume_complete',
      payload: { results },
    }),
  );
}

// ─── Broadcast change to matching subscribers ─────────────

function broadcastChange(db: string, project: string, channel: string, rawPayload: string): void {
  let payload: {
    table?: string;
    op?: string;
    data?: Record<string, unknown>;
    old_data?: Record<string, unknown> | null;
  };

  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return;
  }

  const table = payload.table || 'unknown';
  const op = payload.op || 'UNKNOWN';
  const data = payload.data;

  // Record in sequence tracker
  const eventSeq = seq.record({
    channel,
    project,
    table,
    op: op as 'INSERT' | 'UPDATE' | 'DELETE' | 'UNKNOWN',
    data,
    oldData: payload.old_data || null,
  });

  // Find matching subscriptions
  const matchingIds = subs.getMatchingSubscriptions(project, table);
  if (matchingIds.length === 0) return;

  const message = JSON.stringify({
    type: 'data',
    seq: eventSeq,
    project,
    table,
    op,
    data,
    old_data: payload.old_data || null,
  });

  // Get unique websockets to send to
  const targetWs = new Set<WebSocket>();
  for (const subId of matchingIds) {
    const sub = subs.get(subId);
    if (!sub) continue;

    // Check filter
    if (sub.filter && data) {
      if (!evaluateFilter(data as Record<string, unknown>, sub.filter)) {
        continue;
      }
    }

    // Find the WebSocket for this subscription
    for (const [ws, subIds] of subs['wsSubscriptions']) {
      if (subIds.has(subId) && ws.readyState === WebSocket.OPEN) {
        targetWs.add(ws);
        break;
      }
    }

    // Update last seq
    subs.updateLastSeq(subId, eventSeq);
  }

  // Send to all target WebSockets
  for (const ws of targetWs) {
    ws.send(message);
  }
}

// ─── Start ────────────────────────────────────────────────

await pgListener.start();

server.listen(PORT, () => {
  console.log(`🔌 Keel Realtime v0.2 running on ws://0.0.0.0:${PORT}`);
});

// ─── Graceful shutdown ────────────────────────────────────

const shutdown = async () => {
  console.log('\nShutting down realtime server...');
  wss.clients.forEach((ws) => {
    ws.close(1001, 'Server shutting down');
  });
  wss.close();
  server.close();
  await pgListener.shutdown();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
