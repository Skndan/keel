/**
 * Sequence tracker for reconnection recovery.
 * Assigns monotonically increasing sequence numbers to events
 * and supports replay from a known last-seen position.
 */

const MAX_BUFFER_SIZE = 5000; // keep last 5000 events in memory

interface SequenceEvent {
  seq: number;
  timestamp: number;
  channel: string;
  project: string;
  table: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  data: unknown;
  oldData: unknown | null;
}

export class SequenceTracker {
  private counter = 0;
  private buffer: SequenceEvent[] = [];

  /**
   * Record a new event and return its sequence number.
   */
  record(event: Omit<SequenceEvent, 'seq' | 'timestamp'>): number {
    this.counter++;
    const seq = this.counter;
    this.buffer.push({
      seq,
      timestamp: Date.now(),
      ...event,
    });

    // Trim buffer to max size
    while (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift();
    }

    return seq;
  }

  /**
   * Get the current sequence number.
   */
  getCurrentSeq(): number {
    return this.counter;
  }

  /**
   * Replay events from a given sequence number.
   * Returns events with seq > lastSeen.
   */
  replay(lastSeen: number): SequenceEvent[] {
    return this.buffer.filter((e) => e.seq > lastSeen);
  }

  /**
   * Check if we can replay from the given sequence.
   * Returns false if the sequence is too old (fell off the buffer).
   */
  canReplay(lastSeen: number): boolean {
    if (this.buffer.length === 0) return true;
    return lastSeen >= this.buffer[0].seq - 1;
  }
}
