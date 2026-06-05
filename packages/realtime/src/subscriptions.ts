import type { WebSocket } from 'ws';
import type { SequenceTracker } from './sequence.ts';

/**
 * Represents a client subscription: project + table + optional filter.
 */
export interface Subscription {
  id: string;
  project: string;
  projectDb: string;
  table: string | null; // null = all tables in project
  filter: SubscriptionFilter | null;
  createdAt: number;
  lastSeq: number;
}

export interface SubscriptionFilter {
  column: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
  value: unknown;
}

/**
 * Manages WebSocket client subscriptions.
 */
export class SubscriptionManager {
  // ws → set of subscription IDs
  private wsSubscriptions = new Map<WebSocket, Set<string>>();
  // subscription ID → subscription
  private subscriptions = new Map<string, Subscription>();
  // project:table → set of subscription IDs (for efficient broadcast)
  private tableIndex = new Map<string, Set<string>>();
  private counter = 0;

  /**
   * Add a subscription for a WebSocket client.
   */
  subscribe(
    ws: WebSocket,
    project: string,
    projectDb: string,
    table: string | null,
    filter: SubscriptionFilter | null,
  ): Subscription {
    const id = `sub_${++this.counter}`;
    const sub: Subscription = {
      id,
      project,
      projectDb,
      table,
      filter,
      createdAt: Date.now(),
      lastSeq: 0,
    };

    // Store by ID
    this.subscriptions.set(id, sub);

    // Link to WebSocket
    if (!this.wsSubscriptions.has(ws)) {
      this.wsSubscriptions.set(ws, new Set());
    }
    this.wsSubscriptions.get(ws)!.add(id);

    // Index by table for broadcast
    const tableKey = this.tableKey(project, table);
    if (!this.tableIndex.has(tableKey)) {
      this.tableIndex.set(tableKey, new Set());
    }
    this.tableIndex.get(tableKey)!.add(id);

    // Also add to wildcard (all tables for project)
    const wildcardKey = this.tableKey(project, null);
    if (!this.tableIndex.has(wildcardKey)) {
      this.tableIndex.set(wildcardKey, new Set());
    }
    this.tableIndex.get(wildcardKey)!.add(id);

    return sub;
  }

  /**
   * Unsubscribe a specific subscription.
   */
  unsubscribe(ws: WebSocket, subscriptionId: string): boolean {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return false;

    // Remove from WS mapping
    const wsSubs = this.wsSubscriptions.get(ws);
    if (wsSubs) {
      wsSubs.delete(subscriptionId);
    }

    // Remove from table index
    const tableKey = this.tableKey(sub.project, sub.table);
    const tableSubs = this.tableIndex.get(tableKey);
    if (tableSubs) {
      tableSubs.delete(subscriptionId);
      if (tableSubs.size === 0) this.tableIndex.delete(tableKey);
    }

    this.subscriptions.delete(subscriptionId);
    return true;
  }

  /**
   * Unsubscribe all subscriptions for a WebSocket client.
   */
  unsubscribeAll(ws: WebSocket): void {
    const wsSubs = this.wsSubscriptions.get(ws);
    if (!wsSubs) return;

    for (const subId of wsSubs) {
      const sub = this.subscriptions.get(subId);
      if (sub) {
        const tableKey = this.tableKey(sub.project, sub.table);
        const tableSubs = this.tableIndex.get(tableKey);
        if (tableSubs) {
          tableSubs.delete(subId);
          if (tableSubs.size === 0) this.tableIndex.delete(tableKey);
        }
      }
      this.subscriptions.delete(subId);
    }

    this.wsSubscriptions.delete(ws);
  }

  /**
   * Get all subscription IDs that match a project + table combination.
   */
  getMatchingSubscriptions(project: string, table: string): string[] {
    const result = new Set<string>();

    // Exact table match
    const exactKey = this.tableKey(project, table);
    const exact = this.tableIndex.get(exactKey);
    if (exact) {
      for (const id of exact) result.add(id);
    }

    // Wildcard (all tables)
    const wildcardKey = this.tableKey(project, null);
    const wildcard = this.tableIndex.get(wildcardKey);
    if (wildcard) {
      for (const id of wildcard) result.add(id);
    }

    return Array.from(result);
  }

  /**
   * Get a subscription by ID.
   */
  get(id: string): Subscription | undefined {
    return this.subscriptions.get(id);
  }

  /**
   * Update the last seen sequence for a subscription.
   */
  updateLastSeq(id: string, seq: number): void {
    const sub = this.subscriptions.get(id);
    if (sub) {
      sub.lastSeq = seq;
    }
  }

  /**
   * Get all subscriptions for a WebSocket client.
   */
  getForWs(ws: WebSocket): Subscription[] {
    const wsSubs = this.wsSubscriptions.get(ws);
    if (!wsSubs) return [];
    return Array.from(wsSubs)
      .map((id) => this.subscriptions.get(id))
      .filter(Boolean) as Subscription[];
  }

  /**
   * Get total subscription count.
   */
  get count(): number {
    return this.subscriptions.size;
  }

  /**
   * Get WebSocket count.
   */
  get wsCount(): number {
    return this.wsSubscriptions.size;
  }

  // ─── Private helpers ──────────────────────────────────

  private tableKey(project: string, table: string | null): string {
    return `${project}:${table || '*'}`;
  }
}

/**
 * Evaluate a filter against a data row.
 */
export function evaluateFilter(
  data: Record<string, unknown>,
  filter: SubscriptionFilter,
): boolean {
  const val = data[filter.column];
  const target = filter.value;

  switch (filter.operator) {
    case 'eq':
      return val === target;
    case 'neq':
      return val !== target;
    case 'gt':
      return typeof val === 'number' && typeof target === 'number' && val > target;
    case 'gte':
      return typeof val === 'number' && typeof target === 'number' && val >= target;
    case 'lt':
      return typeof val === 'number' && typeof target === 'number' && val < target;
    case 'lte':
      return typeof val === 'number' && typeof target === 'number' && val <= target;
    case 'in':
      return Array.isArray(target) && target.includes(val);
    case 'contains':
      return typeof val === 'string' && typeof target === 'string' && val.includes(target);
    default:
      return false;
  }
}
