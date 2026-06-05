/**
 * Exponential backoff with jitter.
 * Standard formula: min(cap, base * 2^attempt) + random jitter.
 */

export interface RetryConfig {
  /** Base delay in milliseconds */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds */
  maxDelayMs?: number;
  /** Maximum retry attempts */
  maxAttempts?: number;
  /** Jitter factor (0-1, fraction of delay to randomize) */
  jitter?: number;
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  maxAttempts: 5,
  jitter: 0.1,
};

/**
 * Calculate the delay for a given retry attempt.
 */
export function getRetryDelay(attempt: number, config?: RetryConfig): number {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (attempt >= cfg.maxAttempts) return -1; // no more retries

  const exponential = cfg.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, cfg.maxDelayMs);
  const jitterAmount = capped * cfg.jitter * (Math.random() * 2 - 1); // ± jitter

  return Math.max(0, Math.floor(capped + jitterAmount));
}

/**
 * Execute a function with exponential backoff retry.
 * Returns the result or throws after max attempts.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: RetryConfig,
  onRetry?: (attempt: number, delayMs: number, error: Error) => void,
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt >= cfg.maxAttempts) break;

      const delay = getRetryDelay(attempt, config);
      if (delay < 0) break;

      if (onRetry) {
        onRetry(attempt + 1, delay, lastError);
      }

      await sleep(delay);
    }
  }

  throw lastError || new Error('Retry failed');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
