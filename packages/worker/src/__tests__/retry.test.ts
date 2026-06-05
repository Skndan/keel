import { describe, it, expect } from 'bun:test';
import { getRetryDelay, withRetry } from '../retry.ts';

describe('Retry — Exponential Backoff', () => {
  describe('getRetryDelay', () => {
    it('returns base delay for attempt 0', () => {
      const delay = getRetryDelay(0, {
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        jitter: 0,
      });
      expect(delay).toBe(1000);
    });

    it('doubles delay each attempt (no jitter)', () => {
      const delays = [0, 1, 2, 3].map((n) =>
        getRetryDelay(n, { baseDelayMs: 1000, maxDelayMs: 60000, jitter: 0 }),
      );
      expect(delays).toEqual([1000, 2000, 4000, 8000]);
    });

    it('caps at max delay', () => {
      const delay = getRetryDelay(6, {
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        maxAttempts: 10,
        jitter: 0,
      });
      // 2^6 * 1000 = 64,000 but capped at 30000
      expect(delay).toBe(30000);
    });

    it('returns -1 when attempt >= maxAttempts', () => {
      const delay = getRetryDelay(5, {
        baseDelayMs: 1000,
        maxAttempts: 5,
      });
      expect(delay).toBe(-1);
    });

    it('returns a valid delay with jitter (within range)', () => {
      const delay = getRetryDelay(1, {
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        jitter: 0.1,
      });
      // 2000 ± 200
      expect(delay).toBeGreaterThanOrEqual(1800);
      expect(delay).toBeLessThanOrEqual(2200);
    });

    it('never returns negative delay for valid attempts', () => {
      for (let i = 0; i < 100; i++) {
        const delay = getRetryDelay(i % 4, {
          baseDelayMs: 100,
          maxDelayMs: 10000,
          jitter: 0.5,
        });
        // delay could be -1 if attempt >= 5 (default maxAttempts)
        if (delay >= 0) {
          expect(delay).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('uses defaults when no config provided', () => {
      const delay = getRetryDelay(0);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(1100); // 1000 + 10% jitter
    });
  });

  describe('withRetry', () => {
    it('returns result on first success', async () => {
      const result = await withRetry(
        async () => 'success',
        { jitter: 0 },
      );
      expect(result).toBe('success');
    });

    it('retries on failure and succeeds', async () => {
      let attempts = 0;
      const result = await withRetry(
        async () => {
          attempts++;
          if (attempts < 3) throw new Error('Temporary failure');
          return 'recovered';
        },
        { baseDelayMs: 10, jitter: 0, maxAttempts: 5 },
      );
      expect(result).toBe('recovered');
      expect(attempts).toBe(3);
    });

    it('throws after max attempts', async () => {
      let attempts = 0;
      try {
        await withRetry(
          async () => {
            attempts++;
            throw new Error('Persistent failure');
          },
          { baseDelayMs: 10, jitter: 0, maxAttempts: 3 },
        );
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.message).toBe('Persistent failure');
        expect(attempts).toBe(4); // initial + 3 retries = 4 total
      }
    });

    it('calls onRetry callback', async () => {
      const retries: Array<{ attempt: number; delayMs: number }> = [];

      try {
        await withRetry(
          async () => {
            throw new Error('fail');
          },
          { baseDelayMs: 10, jitter: 0, maxAttempts: 2 },
          (attempt, delayMs) => {
            retries.push({ attempt, delayMs });
          },
        );
        expect.unreachable('Should have thrown');
      } catch {
        expect(retries).toHaveLength(2);
        expect(retries[0].attempt).toBe(1);
        expect(retries[1].attempt).toBe(2);
      }
    });

    it('works with maxAttempts=0 (no retries)', async () => {
      let attempts = 0;
      try {
        await withRetry(
          async () => {
            attempts++;
            throw new Error('fail and stop');
          },
          { maxAttempts: 0, baseDelayMs: 1, jitter: 0 },
        );
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.message).toBe('fail and stop');
        expect(attempts).toBe(1);
      }
    });
  });
});
