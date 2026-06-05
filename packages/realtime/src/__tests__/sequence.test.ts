import { describe, it, expect } from 'bun:test';
import { SequenceTracker } from '../sequence.ts';

describe('SequenceTracker', () => {
  it('starts at 0', () => {
    const tracker = new SequenceTracker();
    expect(tracker.getCurrentSeq()).toBe(0);
  });

  it('increments with each record', () => {
    const tracker = new SequenceTracker();
    const seq1 = tracker.record({
      channel: 'keel_change',
      project: 'myapp',
      table: 'users',
      op: 'INSERT',
      data: { id: 1, name: 'Alice' },
      oldData: null,
    });
    const seq2 = tracker.record({
      channel: 'keel_change',
      project: 'myapp',
      table: 'users',
      op: 'UPDATE',
      data: { id: 1, name: 'Alice Updated' },
      oldData: { id: 1, name: 'Alice' },
    });

    expect(seq1).toBe(1);
    expect(seq2).toBe(2);
    expect(tracker.getCurrentSeq()).toBe(2);
  });

  it('replays events after a given sequence', () => {
    const tracker = new SequenceTracker();

    tracker.record({
      channel: 'keel_change',
      project: 'myapp',
      table: 'users',
      op: 'INSERT',
      data: { id: 1 },
      oldData: null,
    });
    tracker.record({
      channel: 'keel_change',
      project: 'myapp',
      table: 'users',
      op: 'INSERT',
      data: { id: 2 },
      oldData: null,
    });
    tracker.record({
      channel: 'keel_change',
      project: 'myapp',
      table: 'posts',
      op: 'INSERT',
      data: { id: 3 },
      oldData: null,
    });

    const replayed = tracker.replay(1);
    expect(replayed).toHaveLength(2);
    expect(replayed[0].seq).toBe(2);
    expect(replayed[0].data).toEqual({ id: 2 });
    expect(replayed[1].seq).toBe(3);
    expect(replayed[1].data).toEqual({ id: 3 });
  });

  it('returns empty array if no events after sequence', () => {
    const tracker = new SequenceTracker();
    tracker.record({
      channel: 'keel_change',
      project: 'myapp',
      table: 'users',
      op: 'INSERT',
      data: { id: 1 },
      oldData: null,
    });

    const replayed = tracker.replay(1);
    expect(replayed).toHaveLength(0);
  });

  it('canReplay returns true for valid sequence', () => {
    const tracker = new SequenceTracker();
    tracker.record({
      channel: 'keel_change',
      project: 'myapp',
      table: 'users',
      op: 'INSERT',
      data: { id: 1 },
      oldData: null,
    });

    expect(tracker.canReplay(0)).toBe(true);
    expect(tracker.canReplay(1)).toBe(true);
  });

  it('canReplay returns true when buffer is empty', () => {
    const tracker = new SequenceTracker();
    expect(tracker.canReplay(9999)).toBe(true);
  });

  it('tracks timestamps on events', () => {
    const tracker = new SequenceTracker();
    const before = Date.now();
    const seq = tracker.record({
      channel: 'keel_change',
      project: 'myapp',
      table: 'users',
      op: 'INSERT',
      data: { id: 1 },
      oldData: null,
    });

    const [event] = tracker.replay(seq - 1);
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.timestamp).toBeLessThanOrEqual(Date.now());
  });

  it('handles multiple record and replay cycles', () => {
    const tracker = new SequenceTracker();

    // Batch 1
    for (let i = 0; i < 10; i++) {
      tracker.record({
        channel: 'keel_change',
        project: 'myapp',
        table: 'items',
        op: 'INSERT',
        data: { id: i },
        oldData: null,
      });
    }

    expect(tracker.getCurrentSeq()).toBe(10);

    // Replay from 5
    const batch1 = tracker.replay(5);
    expect(batch1).toHaveLength(5);
    expect(batch1[0].seq).toBe(6);

    // Batch 2
    for (let i = 10; i < 20; i++) {
      tracker.record({
        channel: 'keel_change',
        project: 'myapp',
        table: 'items',
        op: 'INSERT',
        data: { id: i },
        oldData: null,
      });
    }

    const batch2 = tracker.replay(10);
    expect(batch2).toHaveLength(10);
  });
});
