import { describe, it, expect, beforeEach } from 'bun:test';
import { WebSocket } from 'ws';
import {
  SubscriptionManager,
  evaluateFilter,
  type SubscriptionFilter,
} from '../subscriptions.ts';

// Helper to create a mock WebSocket
function mockWs(): WebSocket {
  return { readyState: WebSocket.OPEN } as WebSocket;
}

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager;

  beforeEach(() => {
    manager = new SubscriptionManager();
  });

  it('creates subscriptions and tracks them', () => {
    const ws = mockWs();
    const sub = manager.subscribe(ws, 'myapp', 'keel_p_myapp', 'users', null);

    expect(sub.project).toBe('myapp');
    expect(sub.table).toBe('users');
    expect(sub.filter).toBeNull();
    expect(manager.count).toBe(1);
    expect(manager.wsCount).toBe(1);
  });

  it('gets matching subscriptions by project and table', () => {
    const ws1 = mockWs();
    const ws2 = mockWs();

    manager.subscribe(ws1, 'myapp', 'keel_p_myapp', 'users', null);
    manager.subscribe(ws2, 'myapp', 'keel_p_myapp', 'posts', null);

    const userSubs = manager.getMatchingSubscriptions('myapp', 'users');
    expect(userSubs).toHaveLength(2); // Exact + wildcard

    const postSubs = manager.getMatchingSubscriptions('myapp', 'posts');
    expect(postSubs).toHaveLength(2); // Exact + wildcard
  });

  it('wildcard subscription matches all tables', () => {
    const ws = mockWs();
    manager.subscribe(ws, 'myapp', 'keel_p_myapp', null, null); // all tables

    const userSubs = manager.getMatchingSubscriptions('myapp', 'users');
    expect(userSubs).toHaveLength(1);

    const postSubs = manager.getMatchingSubscriptions('myapp', 'posts');
    expect(postSubs).toHaveLength(1);

    const otherSubs = manager.getMatchingSubscriptions('myapp', 'comments');
    expect(otherSubs).toHaveLength(1);
  });

  it('unsubscribes specific subscriptions', () => {
    const ws = mockWs();
    const sub = manager.subscribe(ws, 'myapp', 'keel_p_myapp', 'users', null);

    expect(manager.count).toBe(1);
    const result = manager.unsubscribe(ws, sub.id);
    expect(result).toBe(true);
    expect(manager.count).toBe(0);
  });

  it('unsubscribing non-existent subscription returns false', () => {
    const ws = mockWs();
    const result = manager.unsubscribe(ws, 'nonexistent');
    expect(result).toBe(false);
  });

  it('unsubscribes all for a websocket', () => {
    const ws = mockWs();
    manager.subscribe(ws, 'myapp', 'keel_p_myapp', 'users', null);
    manager.subscribe(ws, 'myapp', 'keel_p_myapp', 'posts', null);
    expect(manager.count).toBe(2);

    manager.unsubscribeAll(ws);
    expect(manager.count).toBe(0);
    expect(manager.wsCount).toBe(0);
  });

  it('separates subscriptions per websocket', () => {
    const ws1 = mockWs();
    const ws2 = mockWs();

    manager.subscribe(ws1, 'myapp', 'keel_p_myapp', 'users', null);
    manager.subscribe(ws2, 'myapp', 'keel_p_myapp', 'posts', null);
    expect(manager.count).toBe(2);

    manager.unsubscribeAll(ws1);
    expect(manager.count).toBe(1);
    expect(manager.wsCount).toBe(1);

    const subs = manager.getForWs(ws2);
    expect(subs).toHaveLength(1);
  });

  it('getForWs returns empty array for unknown websocket', () => {
    const ws = mockWs();
    const subs = manager.getForWs(ws);
    expect(subs).toHaveLength(0);
  });

  it('updates lastSeq on subscription', () => {
    const ws = mockWs();
    const sub = manager.subscribe(ws, 'myapp', 'keel_p_myapp', 'users', null);

    manager.updateLastSeq(sub.id, 42);
    const updated = manager.get(sub.id);
    expect(updated!.lastSeq).toBe(42);
  });

  it('get returns undefined for unknown subscription', () => {
    const sub = manager.get('nonexistent');
    expect(sub).toBeUndefined();
  });

  it('generates unique subscription IDs', () => {
    const ws = mockWs();
    const sub1 = manager.subscribe(ws, 'app1', 'db1', 'users', null);
    const sub2 = manager.subscribe(ws, 'app1', 'db1', 'posts', null);
    expect(sub1.id).not.toBe(sub2.id);
    expect(sub1.id).toMatch(/^sub_\d+$/);
  });
});

describe('evaluateFilter', () => {
  const data = {
    name: 'Alice',
    age: 30,
    email: 'alice@example.com',
    tags: ['admin', 'user'],
    active: true,
  };

  it('eq operator matches exact value', () => {
    const filter: SubscriptionFilter = {
      column: 'name',
      operator: 'eq',
      value: 'Alice',
    };
    expect(evaluateFilter(data, filter)).toBe(true);
    expect(evaluateFilter({ ...data, name: 'Bob' }, filter)).toBe(false);
  });

  it('neq operator matches different values', () => {
    const filter: SubscriptionFilter = {
      column: 'name',
      operator: 'neq',
      value: 'Alice',
    };
    expect(evaluateFilter(data, filter)).toBe(false);
    expect(evaluateFilter({ ...data, name: 'Bob' }, filter)).toBe(true);
  });

  it('gt operator compares numbers', () => {
    const filter: SubscriptionFilter = {
      column: 'age',
      operator: 'gt',
      value: 25,
    };
    expect(evaluateFilter(data, filter)).toBe(true); // 30 > 25
    expect(evaluateFilter({ ...data, age: 20 }, filter)).toBe(false); // 20 > 25 = false
    expect(evaluateFilter({ ...data, age: 25 }, filter)).toBe(false); // 25 > 25 = false
  });

  it('gte operator compares numbers', () => {
    const filter: SubscriptionFilter = {
      column: 'age',
      operator: 'gte',
      value: 30,
    };
    expect(evaluateFilter(data, filter)).toBe(true);
    expect(evaluateFilter({ ...data, age: 29 }, filter)).toBe(false);
  });

  it('lt operator compares numbers', () => {
    const filter: SubscriptionFilter = {
      column: 'age',
      operator: 'lt',
      value: 35,
    };
    expect(evaluateFilter(data, filter)).toBe(true);
    expect(evaluateFilter({ ...data, age: 40 }, filter)).toBe(false);
  });

  it('lte operator compares numbers', () => {
    const filter: SubscriptionFilter = {
      column: 'age',
      operator: 'lte',
      value: 30,
    };
    expect(evaluateFilter(data, filter)).toBe(true);
    expect(evaluateFilter({ ...data, age: 31 }, filter)).toBe(false);
  });

  it('in operator checks array membership', () => {
    const filter: SubscriptionFilter = {
      column: 'name',
      operator: 'in',
      value: ['Alice', 'Bob', 'Charlie'],
    };
    expect(evaluateFilter(data, filter)).toBe(true);
    expect(evaluateFilter({ ...data, name: 'David' }, filter)).toBe(false);
  });

  it('contains operator checks string inclusion', () => {
    const filter: SubscriptionFilter = {
      column: 'email',
      operator: 'contains',
      value: '@example.com',
    };
    expect(evaluateFilter(data, filter)).toBe(true);
    expect(evaluateFilter({ ...data, email: 'alice@gmail.com' }, filter)).toBe(false);
  });

  it('returns false for unknown operator', () => {
    const filter: SubscriptionFilter = {
      column: 'name',
      operator: 'unknown' as any,
      value: 'Alice',
    };
    expect(evaluateFilter(data, filter)).toBe(false);
  });

  it('returns false when column does not exist', () => {
    const filter: SubscriptionFilter = {
      column: 'nonexistent',
      operator: 'eq',
      value: 'test',
    };
    expect(evaluateFilter(data, filter)).toBe(false);
  });

  it('handles null data values', () => {
    const nullData = { name: null };
    const filter: SubscriptionFilter = {
      column: 'name',
      operator: 'eq',
      value: null,
    };
    expect(evaluateFilter(nullData, filter)).toBe(true);
    expect(evaluateFilter(nullData, { ...filter, operator: 'neq' })).toBe(false);
  });
});
