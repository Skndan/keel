import pg from 'pg';

/**
 * Manages multiple PostgreSQL LISTEN connections.
 * Each project database gets its own listener connection.
 */
export class PgListenerManager {
  private masterPool: pg.Pool;
  private projectClients = new Map<string, pg.PoolClient>();
  private listeners = new Map<string, Set<(channel: string, payload: string) => void>>();
  private running = false;

  constructor(masterUrl: string) {
    this.masterPool = new pg.Pool({ connectionString: masterUrl, max: 5 });
  }

  /**
   * Start listening on the master database's keel_change channel.
   */
  async start(): Promise<void> {
    this.running = true;
    await this.listenMaster();
  }

  /**
   * Subscribe to notifications on a specific project database.
   * Creates a new listener connection if needed.
   */
  async subscribeProject(projectDb: string, channel: string): Promise<void> {
    if (!projectDb) return;

    let client = this.projectClients.get(projectDb);
    if (!client) {
      const connStr = this.buildProjectUrl(projectDb);
      client = await this.createListener(connStr, projectDb);
      this.projectClients.set(projectDb, client);
    }

    // Listen on the specific channel
    try {
      await client.query(`LISTEN "${channel}"`);
    } catch (err) {
      console.error(`Failed to LISTEN on ${channel} for ${projectDb}:`, err);
    }
  }

  /**
   * Register a callback for a database+channel combination.
   */
  onNotification(
    db: string,
    channel: string,
    callback: (channel: string, payload: string) => void,
  ): void {
    const key = `${db}:${channel}`;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);
  }

  /**
   * Remove a specific callback.
   */
  offNotification(
    db: string,
    channel: string,
    callback: (channel: string, payload: string) => void,
  ): void {
    const key = `${db}:${channel}`;
    const cbs = this.listeners.get(key);
    if (cbs) {
      cbs.delete(callback);
      if (cbs.size === 0) this.listeners.delete(key);
    }
  }

  /**
   * Close all listener connections.
   */
  async shutdown(): Promise<void> {
    this.running = false;
    for (const client of this.projectClients.values()) {
      client.release();
    }
    this.projectClients.clear();
    this.listeners.clear();
    await this.masterPool.end();
  }

  // ─── Private helpers ──────────────────────────────────

  private buildProjectUrl(dbName: string): string {
    // Reuse the master URL pattern but with the project database name
    const masterUrl = process.env.DATABASE_URL || 'postgresql://keel:keel_dev@localhost:5432/keel_master';
    const url = new URL(masterUrl);
    url.pathname = `/${dbName}`;
    return url.toString();
  }

  private async listenMaster(): Promise<void> {
    const connStr = process.env.DATABASE_URL || 'postgresql://keel:keel_dev@localhost:5432/keel_master';
    const client = await this.masterPool.connect();

    // Listen on the master channel
    await client.query('LISTEN keel_change');

    client.on('notification', (msg) => {
      if (!msg.channel || !msg.payload) return;
      this.dispatchNotification('master', msg.channel, msg.payload);
    });

    client.on('error', (err) => {
      console.error('Master listener error:', err);
      // Attempt reconnect
      if (this.running) {
        setTimeout(() => this.listenMaster(), 1000);
      }
    });

    console.log('📡 Listening on master:keel_change');
  }

  private async createListener(
    connectionString: string,
    dbName: string,
  ): Promise<pg.PoolClient> {
    const pool = new pg.Pool({ connectionString, max: 1 });
    const client = await pool.connect();

    // Listen on the project-level change channel
    await client.query('LISTEN keel_change');

    client.on('notification', (msg) => {
      if (!msg.channel || !msg.payload) return;
      this.dispatchNotification(dbName, msg.channel, msg.payload);
    });

    client.on('error', (err) => {
      console.error(`Listener error for ${dbName}:`, err);
      // Remove and retry
      this.projectClients.delete(dbName);
      if (this.running) {
        setTimeout(() => {
          // Re-subscriptions will trigger new connections
        }, 1000);
      }
    });

    console.log(`📡 Listening on ${dbName}:keel_change`);
    return client;
  }

  private dispatchNotification(db: string, channel: string, payload: string): void {
    // Dispatch to exact db:channel listeners
    const exactKey = `${db}:${channel}`;
    const exactListeners = this.listeners.get(exactKey);
    if (exactListeners) {
      for (const cb of exactListeners) {
        try {
          cb(channel, payload);
        } catch (err) {
          console.error('Notification callback error:', err);
        }
      }
    }

    // Also dispatch to wildcard listeners (any channel from this db)
    const wildcardKey = `${db}:*`;
    const wildcardListeners = this.listeners.get(wildcardKey);
    if (wildcardListeners) {
      for (const cb of wildcardListeners) {
        try {
          cb(channel, payload);
        } catch (err) {
          console.error('Wildcard notification callback error:', err);
        }
      }
    }
  }
}
